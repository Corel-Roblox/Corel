//! Icon images: square 512x512 icons, default countdown overlays (hourglass +
//! label), and compositing an overlay on top of the current icon.

use ab_glyph::{Font, FontVec, OutlineCurve, ScaleFont};
use image::imageops::FilterType;
use tiny_skia::{Color, FillRule, LineCap, LineJoin, Paint, PathBuilder, Pixmap, PixmapPaint, Stroke, Transform};

pub const SIZE: u32 = 512;

fn to_pixmap(img: &image::RgbaImage) -> Pixmap {
    let mut data = img.as_raw().clone();
    for px in data.chunks_exact_mut(4) {
        let a = px[3] as u16;
        for c in &mut px[..3] {
            *c = ((*c as u16 * a + 127) / 255) as u8;
        }
    }
    Pixmap::from_vec(data, tiny_skia::IntSize::from_wh(img.width(), img.height()).unwrap()).unwrap()
}

pub fn decode(bytes: &[u8]) -> Result<image::RgbaImage, String> {
    image::load_from_memory(bytes).map(|i| i.to_rgba8()).map_err(|_| "That file is not an image this app can read (use PNG, JPG or WebP).".to_string())
}

pub fn encode_png(img: &image::RgbaImage) -> Vec<u8> {
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img.clone()).write_to(&mut out, image::ImageFormat::Png).expect("png encode");
    out.into_inner()
}

/// Roblox rejects non-square icons: crop the centre square and scale to 512.
pub fn square_icon(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let img = decode(bytes)?;
    let s = img.width().min(img.height());
    let crop = image::imageops::crop_imm(&img, (img.width() - s) / 2, (img.height() - s) / 2, s, s).to_image();
    Ok(encode_png(&image::imageops::resize(&crop, SIZE, SIZE, FilterType::Lanczos3)))
}

/// Overlays keep transparency; fit inside 512x512.
pub fn fit_overlay(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let img = decode(bytes)?;
    let k = (SIZE as f32 / img.width() as f32).min(SIZE as f32 / img.height() as f32);
    let (w, h) = (((img.width() as f32 * k).round() as u32).max(1), ((img.height() as f32 * k).round() as u32).max(1));
    let small = image::imageops::resize(&img, w, h, FilterType::Lanczos3);
    let mut canvas = image::RgbaImage::new(SIZE, SIZE);
    image::imageops::overlay(&mut canvas, &small, ((SIZE - w) / 2) as i64, ((SIZE - h) / 2) as i64);
    Ok(encode_png(&canvas))
}

/// Heavy font for countdown labels (Segoe UI Black reads like Roblox thumbnail text).
fn overlay_font() -> Option<&'static FontVec> {
    static F: std::sync::OnceLock<Option<FontVec>> = std::sync::OnceLock::new();
    F.get_or_init(|| {
        let dir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
        ["seguibl.ttf", "ariblk.ttf", "segoeuib.ttf", "arialbd.ttf"]
            .iter()
            .find_map(|f| std::fs::read(format!("{dir}\\Fonts\\{f}")).ok().and_then(|b| FontVec::try_from_vec(b).ok()))
    })
    .as_ref()
}

fn font() -> Option<&'static FontVec> {
    static F: std::sync::OnceLock<Option<FontVec>> = std::sync::OnceLock::new();
    F.get_or_init(|| {
        let dir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
        for f in ["ariblk.ttf", "seguibl.ttf", "arialbd.ttf", "segoeuib.ttf"] {
            if let Ok(b) = std::fs::read(format!("{dir}\\Fonts\\{f}")) {
                if let Ok(font) = FontVec::try_from_vec(b) {
                    return Some(font);
                }
            }
        }
        None
    })
    .as_ref()
}

fn text_path(text: &str, px: f32, cx: f32, baseline: f32) -> Option<(tiny_skia::Path, f32)> {
    text_path_with(font()?, text, px, cx, baseline)
}

fn text_path_with(font: &FontVec, text: &str, px: f32, cx: f32, baseline: f32) -> Option<(tiny_skia::Path, f32)> {
    let scaled = font.as_scaled(px);
    let scale = px / font.units_per_em()?;
    let mut width = 0.0;
    let mut prev = None;
    let ids: Vec<_> = text.chars().map(|c| font.glyph_id(c)).collect();
    for &id in &ids {
        if let Some(p) = prev {
            width += scaled.kern(p, id);
        }
        width += scaled.h_advance(id);
        prev = Some(id);
    }
    let mut pb = PathBuilder::new();
    let mut x = cx - width / 2.0;
    prev = None;
    for &id in &ids {
        if let Some(p) = prev {
            x += scaled.kern(p, id);
        }
        if let Some(outline) = font.outline(id) {
            let mut last: Option<ab_glyph::Point> = None;
            let tx = |p: ab_glyph::Point| (x + p.x * scale, baseline - p.y * scale);
            for curve in &outline.curves {
                let (start, end) = match curve {
                    OutlineCurve::Line(a, b) => (*a, *b),
                    OutlineCurve::Quad(a, _, b) => (*a, *b),
                    OutlineCurve::Cubic(a, _, _, b) => (*a, *b),
                };
                if last.map_or(true, |l| (l.x - start.x).abs() > 0.01 || (l.y - start.y).abs() > 0.01) {
                    if last.is_some() {
                        pb.close();
                    }
                    let (sx, sy) = tx(start);
                    pb.move_to(sx, sy);
                }
                match curve {
                    OutlineCurve::Line(_, b) => {
                        let (bx, by) = tx(*b);
                        pb.line_to(bx, by)
                    }
                    OutlineCurve::Quad(_, c, b) => {
                        let ((cx1, cy1), (bx, by)) = (tx(*c), tx(*b));
                        pb.quad_to(cx1, cy1, bx, by)
                    }
                    OutlineCurve::Cubic(_, c1, c2, b) => {
                        let ((ax, ay), (bx1, by1), (bx, by)) = (tx(*c1), tx(*c2), tx(*b));
                        pb.cubic_to(ax, ay, bx1, by1, bx, by)
                    }
                }
                last = Some(end);
            }
            if last.is_some() {
                pb.close();
            }
        }
        x += scaled.h_advance(id);
        prev = Some(id);
    }
    pb.finish().map(|p| (p, width))
}

fn paint(c: Color) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color(c);
    p.anti_alias = true;
    p
}

fn hourglass(pm: &mut Pixmap, cx: f32, cy: f32, h: f32) {
    let w = h * 0.62;
    let (top, bot, bar, neck) = (cy - h / 2.0, cy + h / 2.0, h * 0.1, w * 0.09);
    let mut pb = PathBuilder::new();
    pb.move_to(cx - w * 0.42, top + bar);
    pb.line_to(cx + w * 0.42, top + bar);
    pb.cubic_to(cx + w * 0.42, cy - h * 0.16, cx + neck, cy - h * 0.06, cx + neck, cy);
    pb.cubic_to(cx + neck, cy + h * 0.06, cx + w * 0.42, cy + h * 0.16, cx + w * 0.42, bot - bar);
    pb.line_to(cx - w * 0.42, bot - bar);
    pb.cubic_to(cx - w * 0.42, cy + h * 0.16, cx - neck, cy + h * 0.06, cx - neck, cy);
    pb.cubic_to(cx - neck, cy - h * 0.06, cx - w * 0.42, cy - h * 0.16, cx - w * 0.42, top + bar);
    pb.close();
    let glass = pb.finish().unwrap();
    let st = |wd: f32| Stroke { width: wd, line_cap: LineCap::Round, line_join: LineJoin::Round, ..Default::default() };
    pm.stroke_path(&glass, &paint(Color::from_rgba8(17, 17, 17, 255)), &st(h * 0.16), Transform::identity(), None);
    pm.stroke_path(&glass, &paint(Color::WHITE), &st(h * 0.075), Transform::identity(), None);
    // sand
    let mut s = PathBuilder::new();
    s.move_to(cx - w * 0.26, top + bar + h * 0.1);
    s.line_to(cx + w * 0.26, top + bar + h * 0.1);
    s.line_to(cx, cy - h * 0.04);
    s.close();
    s.move_to(cx, cy + h * 0.14);
    s.line_to(cx + w * 0.3, bot - bar - h * 0.05);
    s.line_to(cx - w * 0.3, bot - bar - h * 0.05);
    s.close();
    pm.fill_path(&s.finish().unwrap(), &paint(Color::WHITE), FillRule::Winding, Transform::identity(), None);
    // bars
    for y in [top, bot - bar] {
        for (pad, col) in [(6.0, Color::from_rgba8(17, 17, 17, 255)), (0.0, Color::WHITE)] {
            let r = tiny_skia::Rect::from_xywh(cx - w / 2.0 - pad, y - pad, w + pad * 2.0, bar + pad * 2.0).unwrap();
            let rad = (bar + pad * 2.0) / 2.0;
            let p = rounded_rect(r, rad);
            pm.fill_path(&p, &paint(col), FillRule::Winding, Transform::identity(), None);
        }
    }
}

fn rounded_rect(r: tiny_skia::Rect, rad: f32) -> tiny_skia::Path {
    let (x, y, w, h) = (r.x(), r.y(), r.width(), r.height());
    let rad = rad.min(w / 2.0).min(h / 2.0);
    let k = 0.5523 * rad;
    let mut pb = PathBuilder::new();
    pb.move_to(x + rad, y);
    pb.line_to(x + w - rad, y);
    pb.cubic_to(x + w - rad + k, y, x + w, y + rad - k, x + w, y + rad);
    pb.line_to(x + w, y + h - rad);
    pb.cubic_to(x + w, y + h - rad + k, x + w - rad + k, y + h, x + w - rad, y + h);
    pb.line_to(x + rad, y + h);
    pb.cubic_to(x + rad - k, y + h, x, y + h - rad + k, x, y + h - rad);
    pb.line_to(x, y + rad);
    pb.cubic_to(x, y + rad - k, x + rad - k, y, x + rad, y);
    pb.close();
    pb.finish().unwrap()
}

/// Clean white hourglass: rounded bars, solid white glass, dark sand (Roblox-thumbnail style).
fn hourglass_clean(pm: &mut Pixmap, cx: f32, top: f32, h: f32) {
    let w = h * 0.70;
    let bar = h * 0.115;
    let (gt, gb) = (top + bar, top + h - bar);
    let cy = (gt + gb) / 2.0;
    let half = w * 0.40;
    let neck = w * 0.06;
    let mut pb = PathBuilder::new();
    pb.move_to(cx - half, gt);
    pb.line_to(cx + half, gt);
    pb.cubic_to(cx + half, cy - h * 0.13, cx + neck, cy - h * 0.07, cx + neck, cy);
    pb.cubic_to(cx + neck, cy + h * 0.07, cx + half, cy + h * 0.13, cx + half, gb);
    pb.line_to(cx - half, gb);
    pb.cubic_to(cx - half, cy + h * 0.13, cx - neck, cy + h * 0.07, cx - neck, cy);
    pb.cubic_to(cx - neck, cy - h * 0.07, cx - half, cy - h * 0.13, cx - half, gt);
    pb.close();
    let glass = pb.finish().unwrap();
    pm.fill_path(&glass, &paint(Color::WHITE), FillRule::Winding, Transform::identity(), None);
    let st = Stroke { width: h * 0.075, line_cap: LineCap::Round, line_join: LineJoin::Round, ..Default::default() };
    pm.stroke_path(&glass, &paint(Color::WHITE), &st, Transform::identity(), None);
    // sand: most of it still in the top bulb, a small mound below, and the falling stream
    let dark = paint(Color::from_rgba8(22, 22, 28, 255));
    let mut sand = PathBuilder::new();
    let t0 = gt + (cy - gt) * 0.22;
    let tw = half * 0.78;
    sand.move_to(cx - tw, t0);
    sand.line_to(cx + tw, t0);
    sand.cubic_to(cx + tw, t0 + (cy - t0) * 0.45, cx + neck * 0.9, cy - h * 0.06, cx + neck * 0.5, cy - h * 0.02);
    sand.line_to(cx - neck * 0.5, cy - h * 0.02);
    sand.cubic_to(cx - neck * 0.9, cy - h * 0.06, cx - tw, t0 + (cy - t0) * 0.45, cx - tw, t0);
    sand.close();
    let b0 = gb - (gb - cy) * 0.30;
    sand.move_to(cx - half * 0.70, gb - h * 0.035);
    sand.quad_to(cx, b0 - h * 0.06, cx + half * 0.70, gb - h * 0.035);
    sand.close();
    pm.fill_path(&sand.finish().unwrap(), &dark, FillRule::Winding, Transform::identity(), None);
    let mut stream = PathBuilder::new();
    stream.move_to(cx, cy - h * 0.01);
    stream.line_to(cx, b0 - h * 0.03);
    pm.stroke_path(&stream.finish().unwrap(), &dark, &Stroke { width: h * 0.02, line_cap: LineCap::Round, ..Default::default() }, Transform::identity(), None);
    // bars
    for y in [top, top + h - bar] {
        let r = tiny_skia::Rect::from_xywh(cx - w / 2.0, y, w, bar).unwrap();
        pm.fill_path(&rounded_rect(r, bar * 0.35), &paint(Color::WHITE), FillRule::Winding, Transform::identity(), None);
    }
}

/// The built-in overlay: dimmed icon, a big white hourglass and a bold uppercase
/// label with a soft shadow ("5 HOURS"), in the style of Roblox countdown thumbnails.
pub fn default_overlay(label: &str) -> Pixmap {
    let mut pm = Pixmap::new(SIZE, SIZE).unwrap();
    pm.fill(Color::from_rgba8(0, 0, 0, 96));
    // soft shadow under the hourglass
    let mut sh = Pixmap::new(SIZE, SIZE).unwrap();
    hourglass_clean(&mut sh, 256.0, 46.0, 292.0);
    for (dy, a) in [(10, 0.18f32), (6, 0.22)] {
        let mut p = PixmapPaint::default();
        p.opacity = a;
        let mut dark = sh.clone();
        for px in dark.pixels_mut() {
            let al = px.alpha();
            *px = tiny_skia::PremultipliedColorU8::from_rgba(0, 0, 0, al).unwrap();
        }
        pm.draw_pixmap(0, dy, dark.as_ref(), &p, Transform::identity(), None);
    }
    hourglass_clean(&mut pm, 256.0, 46.0, 292.0);

    let text = label.to_uppercase();
    let Some(font) = overlay_font() else { return pm };
    let mut px = 118.0;
    let mut tp = text_path_with(font, &text, px, 256.0, 468.0);
    while let Some((_, w)) = &tp {
        if *w <= 476.0 || px <= 30.0 {
            break;
        }
        px -= 4.0;
        tp = text_path_with(font, &text, px, 256.0, 468.0);
    }
    if let Some((path, _)) = tp {
        for (dy, a) in [(9.0, 70u8), (5.0, 80), (2.5, 90)] {
            pm.fill_path(&path, &paint(Color::from_rgba8(0, 0, 0, a)), FillRule::Winding, Transform::from_translate(0.0, dy), None);
        }
        pm.fill_path(&path, &paint(Color::WHITE), FillRule::Winding, Transform::identity(), None);
    }
    pm
}

/// Overlay (custom PNG or default) on top of the base icon. Returns RGBA pixels.
/// Hand-made countdown overlays (white art on transparent, 1024×1024) for the
/// standard timers. Used when a timer's text is exactly "12 Hours", "6 Hours", "3 Hours" or "1 Hour".
fn builtin_overlay(label: &str) -> Option<&'static [u8]> {
    match label.trim().to_lowercase().as_str() {
        "12 hours" => Some(include_bytes!("../assets/overlays/12h.png")),
        "6 hours" => Some(include_bytes!("../assets/overlays/6h.png")),
        "3 hours" => Some(include_bytes!("../assets/overlays/3h.png")),
        "1 hour" => Some(include_bytes!("../assets/overlays/1h.png")),
        _ => None,
    }
}

pub fn composite(base_png: Option<&[u8]>, overlay_png: Option<&[u8]>, label: &str) -> image::RgbaImage {
    let mut pm = match base_png.and_then(|b| decode(b).ok()) {
        Some(img) => to_pixmap(&image::imageops::resize(&img, SIZE, SIZE, FilterType::Lanczos3)),
        None => {
            let mut p = Pixmap::new(SIZE, SIZE).unwrap();
            p.fill(Color::from_rgba8(29, 30, 38, 255));
            p
        }
    };
    let over = match overlay_png.and_then(|b| decode(b).ok()) {
        Some(o) => to_pixmap(&image::imageops::resize(&o, SIZE, SIZE, FilterType::Lanczos3)),
        None => match builtin_overlay(label).and_then(|b| decode(b).ok()) {
            // Bundled artwork for 12h / 6h / 3h / 1h, on a dimmed icon.
            Some(o) => {
                let mut p = Pixmap::new(SIZE, SIZE).unwrap();
                p.fill(Color::from_rgba8(0, 0, 0, 96));
                let art = to_pixmap(&image::imageops::resize(&o, SIZE, SIZE, FilterType::Lanczos3));
                // The artwork sits 42/1024 above center; move it down to center it.
                let dy = (SIZE as f32 * 42.0 / 1024.0).round() as i32;
                p.draw_pixmap(0, dy, art.as_ref(),&PixmapPaint::default(), Transform::identity(), None);
                p
            }
            None => default_overlay(label),
        },
    };
    pm.draw_pixmap(0, 0, over.as_ref(), &PixmapPaint::default(), Transform::identity(), None);
    pixmap_to_rgba(&pm)
}

pub fn pixmap_to_rgba(pm: &Pixmap) -> image::RgbaImage {
    let mut data = Vec::with_capacity((pm.width() * pm.height() * 4) as usize);
    for p in pm.pixels() {
        let c = p.demultiply();
        data.extend_from_slice(&[c.red(), c.green(), c.blue(), c.alpha()]);
    }
    image::RgbaImage::from_raw(pm.width(), pm.height(), data).unwrap()
}

/// The app icon (glowing hourglass on deep violet), at any size.
pub fn app_icon(size: u32) -> image::RgbaImage {
    // Draw large, then scale down, so small sizes stay crisp.
    let big = size.max(256) * 2;
    let img = pixmap_to_rgba(&crate::logo::concept_hourglass(big));
    if big == size {
        img
    } else {
        image::imageops::resize(&img, size, size, FilterType::Lanczos3)
    }
}
