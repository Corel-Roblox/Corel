//! Logo artwork (drawn with tiny-skia so it stays sharp at every size).

use tiny_skia::{Color, FillRule, GradientStop, LineCap, LineJoin, LinearGradient, Paint, Path, PathBuilder, Pixmap, PixmapPaint, Point, RadialGradient, Shader, SpreadMode, Stroke, Transform};

fn c(r: u8, g: u8, b: u8, a: u8) -> Color {
    Color::from_rgba8(r, g, b, a)
}

fn solid(col: Color) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color(col);
    p.anti_alias = true;
    p
}

fn shaded(sh: Shader<'static>) -> Paint<'static> {
    let mut p = Paint::default();
    p.shader = sh;
    p.anti_alias = true;
    p
}

fn linear(x0: f32, y0: f32, x1: f32, y1: f32, stops: &[(f32, Color)]) -> Paint<'static> {
    let st = stops.iter().map(|(t, col)| GradientStop::new(*t, *col)).collect();
    shaded(LinearGradient::new(Point::from_xy(x0, y0), Point::from_xy(x1, y1), st, SpreadMode::Pad, Transform::identity()).unwrap())
}

fn radial(cx: f32, cy: f32, r: f32, stops: &[(f32, Color)]) -> Paint<'static> {
    let st = stops.iter().map(|(t, col)| GradientStop::new(*t, *col)).collect();
    shaded(RadialGradient::new(Point::from_xy(cx, cy), Point::from_xy(cx, cy), r, st, SpreadMode::Pad, Transform::identity()).unwrap())
}

/// iOS-style squircle (superellipse, n = 5) centred at (cx, cy).
fn squircle(cx: f32, cy: f32, half: f32) -> Path {
    let mut pb = PathBuilder::new();
    let n = 5.0f32;
    for i in 0..=256 {
        let t = i as f32 / 256.0 * std::f32::consts::TAU;
        let (ct, st) = (t.cos(), t.sin());
        let x = cx + half * ct.signum() * ct.abs().powf(2.0 / n);
        let y = cy + half * st.signum() * st.abs().powf(2.0 / n);
        if i == 0 { pb.move_to(x, y) } else { pb.line_to(x, y) }
    }
    pb.close();
    pb.finish().unwrap()
}

fn rrect(x: f32, y: f32, w: f32, h: f32, r: f32) -> Path {
    let r = r.min(w / 2.0).min(h / 2.0);
    let k = 0.5523 * r;
    let mut pb = PathBuilder::new();
    pb.move_to(x + r, y);
    pb.line_to(x + w - r, y);
    pb.cubic_to(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
    pb.line_to(x + w, y + h - r);
    pb.cubic_to(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
    pb.line_to(x + r, y + h);
    pb.cubic_to(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
    pb.line_to(x, y + r);
    pb.cubic_to(x, y + r - k, x + r - k, y, x + r, y);
    pb.close();
    pb.finish().unwrap()
}

fn arc(cx: f32, cy: f32, r: f32, start_deg: f32, sweep_deg: f32) -> Path {
    let mut pb = PathBuilder::new();
    let n = ((sweep_deg.abs() / 2.0) as usize).max(8);
    for i in 0..=n {
        let a = (start_deg + sweep_deg * i as f32 / n as f32).to_radians();
        let (x, y) = (cx + r * a.cos(), cy + r * a.sin());
        if i == 0 { pb.move_to(x, y) } else { pb.line_to(x, y) }
    }
    pb.finish().unwrap()
}

fn sector(cx: f32, cy: f32, r: f32, start_deg: f32, sweep_deg: f32) -> Path {
    let mut pb = PathBuilder::new();
    pb.move_to(cx, cy);
    let n = ((sweep_deg.abs() / 2.0) as usize).max(8);
    for i in 0..=n {
        let a = (start_deg + sweep_deg * i as f32 / n as f32).to_radians();
        pb.line_to(cx + r * a.cos(), cy + r * a.sin());
    }
    pb.close();
    pb.finish().unwrap()
}

fn circle(cx: f32, cy: f32, r: f32) -> Path {
    PathBuilder::from_circle(cx, cy, r).unwrap()
}

fn round_stroke(w: f32) -> Stroke {
    Stroke { width: w, line_cap: LineCap::Round, line_join: LineJoin::Round, ..Default::default() }
}

/// Soft drop shadow of `path` (blurred), drawn under whatever comes next.
fn shadow(pm: &mut Pixmap, path: &Path, ts: Transform, col: Color, blur: f32, dy: f32) {
    let (w, h) = (pm.width(), pm.height());
    let mut layer = Pixmap::new(w, h).unwrap();
    layer.fill_path(path, &solid(col), FillRule::Winding, ts.post_translate(0.0, dy), None);
    let img = crate::images::pixmap_to_rgba(&layer);
    let img = image::imageops::blur(&img, blur.max(0.5));
    let mut data = img.into_raw();
    for px in data.chunks_exact_mut(4) {
        let a = px[3] as u16;
        for ch in &mut px[..3] {
            *ch = ((*ch as u16 * a + 127) / 255) as u8;
        }
    }
    let blurred = Pixmap::from_vec(data, tiny_skia::IntSize::from_wh(w, h).unwrap()).unwrap();
    pm.draw_pixmap(0, 0, blurred.as_ref(), &PixmapPaint::default(), Transform::identity(), None);
}

/// Background squircle with a diagonal gradient and a soft top gloss.
fn backdrop(pm: &mut Pixmap, s: f32, stops: &[(f32, Color)]) -> Path {
    let bg = squircle(s / 2.0, s / 2.0, s / 2.0);
    pm.fill_path(&bg, &linear(0.0, 0.0, s, s, stops), FillRule::Winding, Transform::identity(), None);
    pm.fill_path(&bg, &linear(0.0, 0.0, 0.0, s * 0.62, &[(0.0, c(255, 255, 255, 52)), (1.0, c(255, 255, 255, 0))]), FillRule::Winding, Transform::identity(), None);
    bg
}

/// Concept A: a white "game icon" tile, tilted, with a countdown pie on it.
pub fn concept_tile(size: u32) -> Pixmap {
    let s = size as f32;
    let mut pm = Pixmap::new(size, size).unwrap();
    let bg = backdrop(&mut pm, s, &[(0.0, c(132, 96, 255, 255)), (0.55, c(176, 74, 246, 255)), (1.0, c(255, 96, 160, 255))]);
    // light bloom behind the tile
    pm.fill_path(&bg, &radial(s * 0.5, s * 0.46, s * 0.45, &[(0.0, c(255, 255, 255, 60)), (1.0, c(255, 255, 255, 0))]), FillRule::Winding, Transform::identity(), None);
    let ts = Transform::from_rotate_at(-9.0, s / 2.0, s / 2.0);
    let tw = s * 0.54;
    let tile = rrect(s / 2.0 - tw / 2.0, s / 2.0 - tw / 2.0, tw, tw, s * 0.14);
    shadow(&mut pm, &tile, ts, c(40, 8, 90, 120), s * 0.035, s * 0.035);
    pm.fill_path(&tile, &linear(0.0, s * 0.23, 0.0, s * 0.77, &[(0.0, c(255, 255, 255, 255)), (1.0, c(236, 232, 255, 255))]), FillRule::Winding, ts, None);
    let (cx, cy, r) = (s / 2.0, s / 2.0, s * 0.165);
    pm.fill_path(&circle(cx, cy, r), &solid(c(124, 92, 255, 38)), FillRule::Winding, ts, None);
    let pie = linear(cx - r, cy - r, cx + r, cy + r, &[(0.0, c(124, 92, 255, 255)), (1.0, c(240, 90, 180, 255))]);
    pm.fill_path(&sector(cx, cy, r, -90.0, 270.0), &pie, FillRule::Winding, ts, None);
    pm.fill_path(&circle(cx, cy, s * 0.035), &solid(Color::WHITE), FillRule::Winding, ts, None);
    pm
}

/// Hourglass in unit space (0..s), drawn through `ts`.
fn draw_hourglass(pm: &mut Pixmap, s: f32, ts: Transform, glass: Color, sand_a: Color, sand_b: Color, stream: Color) {
    let at = |x: f32, y: f32| (x * s, y * s);
    let mut g = PathBuilder::new();
    let (x, y) = at(0.33, 0.27);
    g.move_to(x, y);
    let (c1x, c1y) = at(0.33, 0.42);
    let (nx, ny) = at(0.47, 0.5);
    g.quad_to(c1x, c1y, nx, ny);
    let (c2x, c2y) = at(0.33, 0.58);
    let (bx, by) = at(0.33, 0.73);
    g.quad_to(c2x, c2y, bx, by);
    let (x, y) = at(0.67, 0.73);
    g.move_to(x, y);
    let (c3x, c3y) = at(0.67, 0.58);
    let (n2x, n2y) = at(0.53, 0.5);
    g.quad_to(c3x, c3y, n2x, n2y);
    let (c4x, c4y) = at(0.67, 0.42);
    let (tx, ty) = at(0.67, 0.27);
    g.quad_to(c4x, c4y, tx, ty);
    let glass_path = g.finish().unwrap();
    let sand = |x0: f32, y0: f32, x1: f32, y1: f32| linear(x0 * s, y0 * s, x1 * s, y1 * s, &[(0.0, sand_a), (1.0, sand_b)]);
    let mut t = PathBuilder::new();
    t.move_to(0.375 * s, 0.37 * s);
    t.line_to(0.625 * s, 0.37 * s);
    t.quad_to(0.6 * s, 0.44 * s, 0.5 * s, 0.48 * s);
    t.quad_to(0.4 * s, 0.44 * s, 0.375 * s, 0.37 * s);
    t.close();
    pm.fill_path(&t.finish().unwrap(), &sand(0.4, 0.36, 0.6, 0.48), FillRule::Winding, ts, None);
    let mut b = PathBuilder::new();
    b.move_to(0.355 * s, 0.705 * s);
    b.quad_to(0.5 * s, 0.56 * s, 0.645 * s, 0.705 * s);
    b.close();
    pm.fill_path(&b.finish().unwrap(), &sand(0.4, 0.6, 0.6, 0.71), FillRule::Winding, ts, None);
    let mut st = PathBuilder::new();
    st.move_to(0.5 * s, 0.49 * s);
    st.line_to(0.5 * s, 0.62 * s);
    pm.stroke_path(&st.finish().unwrap(), &solid(stream), &round_stroke(s * 0.016), ts, None);
    pm.stroke_path(&glass_path, &solid(glass), &round_stroke(s * 0.042), ts, None);
    for yy in [0.215, 0.725] {
        pm.fill_path(&rrect(0.27 * s, yy * s, 0.46 * s, 0.06 * s, 0.03 * s), &solid(glass), FillRule::Winding, ts, None);
    }
}

/// Concept B: glowing hourglass on deep violet.
pub fn concept_hourglass(size: u32) -> Pixmap {
    let s = size as f32;
    let mut pm = Pixmap::new(size, size).unwrap();
    let bg = backdrop(&mut pm, s, &[(0.0, c(52, 30, 128, 255)), (1.0, c(22, 14, 58, 255))]);
    pm.fill_path(&bg, &radial(s * 0.5, s * 0.62, s * 0.5, &[(0.0, c(255, 110, 170, 90)), (1.0, c(255, 110, 170, 0))]), FillRule::Winding, Transform::identity(), None);
    draw_hourglass(&mut pm, s, Transform::identity(), Color::WHITE, c(255, 196, 92, 255), c(255, 92, 160, 255), c(255, 160, 130, 255));
    pm
}

/// Concept C: the tilted white tile from A, with a gradient hourglass on it.
pub fn concept_tile_hourglass(size: u32) -> Pixmap {
    let s = size as f32;
    let mut pm = Pixmap::new(size, size).unwrap();
    let bg = backdrop(&mut pm, s, &[(0.0, c(132, 96, 255, 255)), (0.55, c(176, 74, 246, 255)), (1.0, c(255, 96, 160, 255))]);
    pm.fill_path(&bg, &radial(s * 0.5, s * 0.46, s * 0.45, &[(0.0, c(255, 255, 255, 60)), (1.0, c(255, 255, 255, 0))]), FillRule::Winding, Transform::identity(), None);
    let ts = Transform::from_rotate_at(-9.0, s / 2.0, s / 2.0);
    let tw = s * 0.56;
    let tile = rrect(s / 2.0 - tw / 2.0, s / 2.0 - tw / 2.0, tw, tw, s * 0.145);
    shadow(&mut pm, &tile, ts, c(40, 8, 90, 120), s * 0.035, s * 0.035);
    pm.fill_path(&tile, &linear(0.0, s * 0.22, 0.0, s * 0.78, &[(0.0, c(255, 255, 255, 255)), (1.0, c(236, 232, 255, 255))]), FillRule::Winding, ts, None);
    let k = 0.66;
    let inner = Transform::from_translate(s / 2.0 * (1.0 - k), s / 2.0 * (1.0 - k)).pre_scale(k, k).post_concat(ts);
    draw_hourglass(&mut pm, s, inner, c(104, 74, 240, 255), c(255, 170, 70, 255), c(240, 70, 160, 255), c(250, 120, 140, 255));
    pm
}

/// Concept C: an "R" monogram inside a countdown ring with a glowing tip.
pub fn concept_monogram(size: u32) -> Pixmap {
    let s = size as f32;
    let mut pm = Pixmap::new(size, size).unwrap();
    let bg = backdrop(&mut pm, s, &[(0.0, c(122, 92, 255, 255)), (1.0, c(66, 44, 214, 255))]);
    pm.fill_path(&bg, &radial(s * 0.3, s * 0.2, s * 0.6, &[(0.0, c(255, 140, 220, 70)), (1.0, c(255, 140, 220, 0))]), FillRule::Winding, Transform::identity(), None);
    let id = Transform::identity();
    let (cx, cy, rr) = (s / 2.0, s / 2.0, s * 0.34);
    let w = s * 0.06;
    pm.stroke_path(&arc(cx, cy, rr, 0.0, 360.0), &solid(c(255, 255, 255, 46)), &round_stroke(w), id, None);
    // comet-style arc: fades in from the start, bright at the tip
    let segs = 60;
    for i in 0..segs {
        let a0 = -90.0 + 290.0 * i as f32 / segs as f32;
        let a1 = -90.0 + 290.0 * (i + 1) as f32 / segs as f32;
        let alpha = (40.0 + 215.0 * (i as f32 / segs as f32).powf(0.7)) as u8;
        pm.stroke_path(&arc(cx, cy, rr, a0, a1 - a0 + 0.6), &solid(c(255, 255, 255, alpha)), &round_stroke(w), id, None);
    }
    let tip = (-90.0f32 + 290.0).to_radians();
    let (tx, ty) = (cx + rr * tip.cos(), cy + rr * tip.sin());
    pm.fill_path(&circle(tx, ty, w * 1.6), &radial(tx, ty, w * 1.6, &[(0.0, c(255, 200, 240, 200)), (1.0, c(255, 200, 240, 0))]), FillRule::Winding, id, None);
    pm.fill_path(&circle(tx, ty, w * 0.62), &solid(Color::WHITE), FillRule::Winding, id, None);
    // R
    let sw = s * 0.085;
    let mut r = PathBuilder::new();
    let (x0, top, mid, bot) = (0.415 * s, 0.335 * s, 0.505 * s, 0.665 * s);
    r.move_to(x0, bot);
    r.line_to(x0, top);
    let bowl_r = (mid - top) / 2.0;
    let bx = 0.53 * s;
    r.line_to(bx, top);
    for i in 0..=24 {
        let a = (-90.0 + 180.0 * i as f32 / 24.0f32).to_radians();
        r.line_to(bx + bowl_r * a.cos(), top + bowl_r + bowl_r * a.sin());
    }
    r.line_to(x0, mid);
    r.move_to(0.52 * s, mid);
    r.line_to(0.615 * s, bot);
    let rp = r.finish().unwrap();
    let st = round_stroke(sw);
    if let Some(outline) = rp.stroke(&st, 1.0) {
        shadow(&mut pm, &outline, id, c(30, 10, 90, 110), s * 0.02, s * 0.02);
    }
    pm.stroke_path(&rp, &solid(Color::WHITE), &st, id, None);
    pm
}
