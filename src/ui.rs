//! Theme, fonts and small custom widgets matching the Roicon look.

use egui::{pos2, vec2, Align2, Color32, CornerRadius, FontFamily, FontId, Frame, Id, Margin, Painter, Pos2, Rect, Response, Sense, Shape, Stroke, StrokeKind, Ui, Vec2};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

pub const BG: Color32 = Color32::from_rgb(11, 11, 16);
pub const PANEL: Color32 = Color32::from_rgb(18, 19, 25);
pub const PANEL3: Color32 = Color32::from_rgb(29, 30, 39);
pub const LINE: Color32 = Color32::from_rgb(34, 35, 45);
pub const LINE2: Color32 = Color32::from_rgb(44, 45, 57);
pub const TEXT: Color32 = Color32::from_rgb(236, 235, 245);
pub const MUTED: Color32 = Color32::from_rgb(141, 140, 158);
pub const DIM: Color32 = Color32::from_rgb(95, 94, 112);
pub const ACCENT: Color32 = Color32::from_rgb(109, 93, 252);
pub const ACCENT_HI: Color32 = Color32::from_rgb(122, 107, 255);
pub const ACCENT_TXT: Color32 = Color32::from_rgb(160, 150, 255);
pub const GREEN: Color32 = Color32::from_rgb(61, 220, 151);
pub const AMBER: Color32 = Color32::from_rgb(245, 181, 68);
pub const RED: Color32 = Color32::from_rgb(248, 113, 113);
/// The logo's sand colours, used for highlights.
pub const SAND: Color32 = Color32::from_rgb(255, 190, 92);
pub const PINK: Color32 = Color32::from_rgb(244, 96, 164);
/// Primary gradient (violet to magenta).
pub const GRAD_A: Color32 = Color32::from_rgb(128, 100, 255);
pub const GRAD_B: Color32 = Color32::from_rgb(184, 82, 240);

// ------------------------------------------------------------------ motion

pub fn ease_out(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    1.0 - (1.0 - t).powi(3)
}

/// Value that glides toward `target` (exponential smoothing, frame-rate independent).
pub fn smooth(ctx: &egui::Context, id: Id, target: f32, speed: f32) -> f32 {
    let dt = ctx.input(|i| i.stable_dt).clamp(0.0, 0.05);
    let cur = ctx.data_mut(|d| *d.get_temp_mut_or(id, target));
    let k = 1.0 - (-speed * dt).exp();
    let mut next = cur + (target - cur) * k;
    if (target - next).abs() < 0.004 * target.abs().max(1.0) {
        next = target;
    } else {
        ctx.request_repaint();
    }
    ctx.data_mut(|d| d.insert_temp(id, next));
    next
}

/// 0 -> 1 hover amount that eases in and out.
pub fn hover_amt(ctx: &egui::Context, id: Id, on: bool) -> f32 {
    smooth(ctx, id.with("hover"), if on { 1.0 } else { 0.0 }, 18.0)
}

static PAGE_T0: AtomicU64 = AtomicU64::new(0);

static PAGE_PENDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Restart the page-enter animation (call when the visible page changes).
/// The clock starts on the *next* frame, so a slow first frame (loading
/// textures) can't make the animation skip ahead.
pub fn page_changed(ctx: &egui::Context) {
    PAGE_PENDING.store(true, Ordering::Relaxed);
    ctx.request_repaint();
}

/// Page-enter progress, 0 -> 1 eased over ~0.32 s.
pub fn page_t(ctx: &egui::Context) -> f32 {
    let now = ctx.input(|i| i.time);
    if PAGE_PENDING.swap(false, Ordering::Relaxed) {
        PAGE_T0.store(now.to_bits(), Ordering::Relaxed);
        ctx.request_repaint();
        return 0.0;
    }
    let t0 = f64::from_bits(PAGE_T0.load(Ordering::Relaxed));
    let t = ((now - t0) as f32 / 0.32).clamp(0.0, 1.0);
    if t < 1.0 {
        ctx.request_repaint();
    }
    ease_out(t)
}

/// Page-enter progress (0 -> 1, eased) for something that starts `delay` seconds in.
pub fn appear(ctx: &egui::Context, delay: f32) -> f32 {
    // Page switches no longer fade (it read as a flicker); content appears at once.
    let _ = (ctx, delay, &PAGE_T0);
    1.0
}

/// Rounded rect filled with a gradient: `color_at(tx, ty)` for tx, ty in 0..1.
/// The edge gets a 1px fade (like egui's own shapes) so corners aren't jagged.
pub fn grad_rrect(r: Rect, rad: f32, color_at: impl Fn(f32, f32) -> Color32) -> Shape {
    let feather = 1.0;
    let r_in = r.shrink(feather * 0.5);
    let rad = (rad - feather * 0.5).min(r_in.width() / 2.0).min(r_in.height() / 2.0).max(0.5);
    let col = |p: Pos2| color_at(((p.x - r.left()) / r.width()).clamp(0.0, 1.0), ((p.y - r.top()) / r.height()).clamp(0.0, 1.0));
    let corners = [
        (pos2(r_in.right() - rad, r_in.top() + rad), -90.0f32),
        (pos2(r_in.right() - rad, r_in.bottom() - rad), 0.0),
        (pos2(r_in.left() + rad, r_in.bottom() - rad), 90.0),
        (pos2(r_in.left() + rad, r_in.top() + rad), 180.0),
    ];
    let mut ring: Vec<(Pos2, Vec2)> = Vec::new();
    for (c, start) in corners {
        for i in 0..=10 {
            let a = (start + 9.0 * i as f32).to_radians();
            let n = vec2(a.cos(), a.sin());
            ring.push((c + n * rad, n));
        }
    }
    let mut mesh = egui::Mesh::default();
    mesh.colored_vertex(r.center(), col(r.center()));
    let n = ring.len() as u32;
    for (p, _) in &ring {
        mesh.colored_vertex(*p, col(*p));
    }
    for (p, nrm) in &ring {
        mesh.colored_vertex(*p + *nrm * feather, Color32::TRANSPARENT);
    }
    for i in 0..n {
        let j = (i + 1) % n;
        mesh.add_triangle(0, 1 + i, 1 + j);
        // feather strip
        mesh.add_triangle(1 + i, 1 + n + i, 1 + n + j);
        mesh.add_triangle(1 + i, 1 + n + j, 1 + j);
    }
    Shape::mesh(mesh)
}

/// Horizontal gradient (a -> b) in a rounded rect.
pub fn brand_rrect(r: Rect, rad: f32, a: Color32, b: Color32) -> Shape {
    grad_rrect(r, rad, |tx, _| a.lerp_to_gamma(b, tx))
}

// ------------------------------------------------------------------ website look

/// Light violet and magenta used in the moving "shine" gradient (like the website headline).
pub const LILAC: Color32 = Color32::from_rgb(155, 133, 255);
pub const ORCHID: Color32 = Color32::from_rgb(200, 109, 245);
const SHINE: [Color32; 6] = [LILAC, ORCHID, PINK, SAND, ORCHID, LILAC];

/// Colour at `t` (wraps) along a looping list of stops.
pub fn sample(stops: &[Color32], t: f32) -> Color32 {
    let n = stops.len() - 1;
    let x = t.rem_euclid(1.0) * n as f32;
    let i = (x as usize).min(n - 1);
    stops[i].lerp_to_gamma(stops[i + 1], x - i as f32)
}

/// Text whose letters are coloured by `col(t)` for t in 0..1 across the text.
pub fn grad_galley(p: &Painter, text: &str, font: FontId, spacing: f32, col: impl Fn(f32) -> Color32) -> Arc<egui::Galley> {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len().max(2) - 1;
    let mut job = egui::text::LayoutJob::default();
    for (i, ch) in chars.iter().enumerate() {
        let mut buf = [0u8; 4];
        job.append(ch.encode_utf8(&mut buf), 0.0, egui::TextFormat { font_id: font.clone(), color: col(i as f32 / n as f32), extra_letter_spacing: spacing, ..Default::default() });
    }
    p.layout_job(job)
}

/// Animated yellow-pink-purple gradient text (the website's "counts down." look). Returns its rect.
pub fn shine_text(p: &Painter, pos: Pos2, align: Align2, text: &str, font: FontId, time: f64) -> Rect {
    let shift = (time / 9.0) as f32;
    let g = grad_galley(p, text, font, 0.0, |t| sample(&SHINE, t / 3.0 - shift));
    let r = align.anchor_size(pos, g.size());
    p.galley(r.min, g, TEXT);
    p.ctx().request_repaint_after(std::time::Duration::from_millis(33));
    r
}

/// Warm (sand to pink) gradient text, e.g. for section labels.
pub fn warm_text(p: &Painter, pos: Pos2, align: Align2, text: &str, font: FontId, spacing: f32) -> Rect {
    let g = grad_galley(p, text, font, spacing, |t| SAND.lerp_to_gamma(PINK, t));
    let r = align.anchor_size(pos, g.size());
    p.galley(r.min, g, TEXT);
    r
}

/// Rounded rect filled by a colour field (sampled on concentric rings), for smooth
/// radial lights that stay inside the rounded corners.
pub fn rrect_field(r: Rect, rad: f32, f: impl Fn(Pos2) -> Color32) -> Shape {
    let rad = rad.min(r.width() / 2.0).min(r.height() / 2.0);
    let corners = [
        (pos2(r.right() - rad, r.top() + rad), -90.0f32),
        (pos2(r.right() - rad, r.bottom() - rad), 0.0),
        (pos2(r.left() + rad, r.bottom() - rad), 90.0),
        (pos2(r.left() + rad, r.top() + rad), 180.0),
    ];
    let mut edge = Vec::new();
    for (c, start) in corners {
        for i in 0..=6 {
            let a = (start + 15.0 * i as f32).to_radians();
            edge.push(c + vec2(a.cos(), a.sin()) * rad);
        }
    }
    let mut pts = Vec::new();
    for i in 0..edge.len() {
        let (a, b) = (edge[i], edge[(i + 1) % edge.len()]);
        let n = ((a.distance(b) / 40.0) as usize).max(1);
        for k in 0..n {
            pts.push(a.lerp(b, k as f32 / n as f32));
        }
    }
    let ctr = r.center();
    let rings = 8;
    let mut mesh = egui::Mesh::default();
    mesh.colored_vertex(ctr, f(ctr));
    let n = pts.len() as u32;
    for j in 1..=rings {
        let t = j as f32 / rings as f32;
        for p in &pts {
            let q = ctr.lerp(*p, t);
            mesh.colored_vertex(q, f(q));
        }
    }
    for i in 0..n {
        mesh.add_triangle(0, 1 + i, 1 + (i + 1) % n);
    }
    for j in 1..rings as u32 {
        let (a0, b0) = (1 + (j - 1) * n, 1 + j * n);
        for i in 0..n {
            let i1 = (i + 1) % n;
            mesh.add_triangle(a0 + i, b0 + i, b0 + i1);
            mesh.add_triangle(a0 + i, b0 + i1, a0 + i1);
        }
    }
    // 1px fade outside the edge so the rounded corners are smooth
    let outer = 1 + (rings as u32 - 1) * n;
    let base = mesh.vertices.len() as u32;
    for p in &pts {
        let d = (*p - ctr).normalized();
        let nrm = if (p.x - r.left()).abs() < 0.01 || (p.x - r.right()).abs() < 0.01 { vec2(d.x.signum(), 0.0) } else if (p.y - r.top()).abs() < 0.01 || (p.y - r.bottom()).abs() < 0.01 { vec2(0.0, d.y.signum()) } else { d };
        mesh.colored_vertex(*p + nrm, Color32::TRANSPARENT);
    }
    for i in 0..n {
        let i1 = (i + 1) % n;
        mesh.add_triangle(outer + i, base + i, base + i1);
        mesh.add_triangle(outer + i, base + i1, outer + i1);
    }
    Shape::mesh(mesh)
}

/// A card frame with the website's pointer spotlight: a soft violet light that
/// follows the mouse inside the card (drawn under the content).
pub fn spot<R>(ui: &mut Ui, frame: Frame, add: impl FnOnce(&mut Ui) -> R) -> egui::InnerResponse<R> {
    let mut idx = None;
    let r = frame.show(ui, |ui| {
        idx = Some(ui.painter().add(Shape::Noop));
        add(ui)
    });
    let rect = r.response.rect;
    let ctx = ui.ctx().clone();
    let id = r.response.id.with("spot");
    let over = ui.rect_contains_pointer(rect);
    let h = hover_amt(&ctx, id, over);
    if let (Some(i), true) = (idx, h > 0.01) {
        let ptr = ctx.pointer_hover_pos().unwrap_or(rect.center());
        let mx = smooth(&ctx, id.with("x"), ptr.x, 22.0);
        let my = smooth(&ctx, id.with("y"), ptr.y, 22.0);
        let m = pos2(mx, my);
        let rad = (frame.corner_radius.nw as f32).max(4.0);
        ui.painter().set(i, rrect_field(rect.shrink(1.0), rad, |q| {
            let d = (1.0 - q.distance(m) / 300.0).max(0.0);
            Color32::from_rgba_unmultiplied(170, 120, 255, (d * d * 40.0 * h) as u8)
        }));
        ui.painter().rect_stroke(rect, frame.corner_radius, Stroke::new(1.0, Color32::from_rgba_unmultiplied(170, 130, 255, (70.0 * h) as u8)), StrokeKind::Inside);
    }
    r
}

/// A progress node like the website timeline: done (pink ring + check), current
/// (warm gradient with a pulsing halo), upcoming (grey ring), error (red), live (green).
#[derive(Clone, Copy, PartialEq)]
pub enum Node {
    Done,
    Current,
    Upcoming,
    Error,
    Live,
    Skipped,
}

pub fn node(p: &Painter, c: Pos2, r: f32, state: Node, label: Option<&str>, time: f64) {
    let t = time as f32;
    // solid base so the timeline line never shows through a see-through dot
    p.circle_filled(c, r, Color32::from_rgb(19, 18, 28));
    match state {
        Node::Done => {
            p.circle_filled(c, r, Color32::from_rgba_unmultiplied(244, 96, 164, 40));
            p.circle_stroke(c, r - 1.0, Stroke::new(1.6, Color32::from_rgba_unmultiplied(244, 96, 164, 150)));
            check(p, c, r * 0.42, PINK);
        }
        Node::Live => {
            let pulse = (t * 1.2).fract();
            p.circle_filled(c, r + 7.0 * pulse, Color32::from_rgba_unmultiplied(61, 220, 151, (70.0 * (1.0 - pulse)) as u8));
            p.add(grad_rrect(Rect::from_center_size(c, Vec2::splat(r * 2.0)), r, |tx, ty| GREEN.lerp_to_gamma(Color32::from_rgb(79, 214, 232), (tx + ty) / 2.0)));
            check(p, c, r * 0.42, Color32::from_rgb(6, 36, 24));
            p.ctx().request_repaint_after(std::time::Duration::from_millis(33));
        }
        Node::Current => {
            let pulse = (t * 1.1).fract();
            p.circle_filled(c, r + 8.0 * pulse, Color32::from_rgba_unmultiplied(255, 170, 100, (60.0 * (1.0 - pulse)) as u8));
            p.circle_filled(c, r + 3.0, Color32::from_rgba_unmultiplied(255, 170, 100, 36));
            p.add(grad_rrect(Rect::from_center_size(c, Vec2::splat(r * 2.0)), r, |tx, ty| SAND.lerp_to_gamma(PINK, (tx + ty) / 2.0)));
            if let Some(l) = label {
                p.text(c, Align2::CENTER_CENTER, l, bold(r * 1.05), Color32::from_rgb(26, 15, 5));
            } else {
                p.circle_filled(c, r * 0.32, Color32::from_rgb(26, 15, 5));
            }
            p.ctx().request_repaint_after(std::time::Duration::from_millis(33));
        }
        Node::Upcoming | Node::Skipped => {
            p.circle_filled(c, r, Color32::from_rgb(21, 19, 31));
            p.circle_stroke(c, r - 1.0, Stroke::new(1.6, Color32::from_white_alpha(if state == Node::Skipped { 16 } else { 34 })));
            if let Some(l) = label {
                p.text(c, Align2::CENTER_CENTER, l, bold(r * 1.0), MUTED);
            } else if state == Node::Skipped {
                p.line_segment([c - vec2(r * 0.35, 0.0), c + vec2(r * 0.35, 0.0)], Stroke::new(1.6, DIM));
            }
        }
        Node::Error => {
            p.circle_filled(c, r, Color32::from_rgba_unmultiplied(248, 113, 113, 40));
            p.circle_stroke(c, r - 1.0, Stroke::new(1.6, RED));
            p.text(c, Align2::CENTER_CENTER, "!", bold(r * 1.0), RED);
        }
    }
}

fn check(p: &Painter, c: Pos2, s: f32, col: Color32) {
    p.line(vec![c + vec2(-s, 0.0), c + vec2(-s * 0.3, s * 0.7), c + vec2(s, -s * 0.7)], Stroke::new(1.8, col));
}

/// Gradient progress line between two points (horizontal or vertical) with a glowing tip.
pub fn progress_line(p: &Painter, a: Pos2, b: Pos2, frac: f32, width: f32, tip: bool) {
    let vertical = (b.y - a.y).abs() > (b.x - a.x).abs();
    let track = if vertical { Rect::from_min_max(pos2(a.x - width / 2.0, a.y), pos2(a.x + width / 2.0, b.y)) } else { Rect::from_min_max(pos2(a.x, a.y - width / 2.0), pos2(b.x, a.y + width / 2.0)) };
    p.rect_filled(track, width / 2.0, Color32::from_white_alpha(18));
    let frac = frac.clamp(0.0, 1.0);
    if frac <= 0.001 {
        return;
    }
    let end = a.lerp(b, frac);
    let fill = if vertical { Rect::from_min_max(pos2(a.x - width / 2.0, a.y), pos2(a.x + width / 2.0, end.y)) } else { Rect::from_min_max(pos2(a.x, a.y - width / 2.0), pos2(end.x, a.y + width / 2.0)) };
    p.add(grad_rrect(fill, width / 2.0, |tx, ty| SAND.lerp_to_gamma(PINK, if vertical { ty } else { tx })));
    if tip && frac < 0.999 {
        glow(p, end, width * 5.0, Color32::from_rgba_unmultiplied(244, 96, 164, 120));
        p.circle_filled(end, width * 0.9, Color32::WHITE);
    }
}

static LOGO: OnceLock<egui::TextureId> = OnceLock::new();

pub fn set_logo(id: egui::TextureId) {
    let _ = LOGO.set(id);
}

/// Game names from Roblox often contain emoji with invisible modifier characters
/// (variation selectors, zero-width joiners, skin tones) that egui draws as boxes.
pub fn clean(s: &str) -> String {
    s.chars()
        .filter(|c| !matches!(*c, '\u{FE0E}' | '\u{FE0F}' | '\u{200D}' | '\u{20E3}') && !('\u{1F3FB}'..='\u{1F3FF}').contains(c))
        .collect()
}

pub fn bold(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("bold".into()))
}
pub fn semi(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("semibold".into()))
}
pub fn reg(size: f32) -> FontId {
    FontId::new(size, FontFamily::Proportional)
}

pub fn setup(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();
    let dir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
    let load = |f: &str| std::fs::read(format!("{dir}\\Fonts\\{f}")).ok();
    let mut add = |name: &str, files: &[&str], family: FontFamily| {
        if let Some(bytes) = files.iter().find_map(|f| load(f)) {
            fonts.font_data.insert(name.into(), Arc::new(egui::FontData::from_owned(bytes)));
            let fam = fonts.families.entry(family).or_default();
            fam.insert(0, name.into());
        }
    };
    add("ui-regular", &["segoeui.ttf"], FontFamily::Proportional);
    add("ui-bold", &["segoeuib.ttf"], FontFamily::Name("bold".into()));
    add("ui-semibold", &["seguisb.ttf", "segoeuib.ttf"], FontFamily::Name("semibold".into()));
    // Fallbacks (appended, not first): symbols and emoji such as the snowflake in "[❄️] Build a Snowman".
    for (name, file) in [("ui-symbols", "seguisym.ttf"), ("ui-emoji", "seguiemj.ttf")] {
        if let Some(bytes) = load(file) {
            fonts.font_data.insert(name.into(), Arc::new(egui::FontData::from_owned(bytes)));
            fonts.families.entry(FontFamily::Proportional).or_default().push(name.into());
        }
    }
    // Fallbacks so the named families always resolve.
    let prop = fonts.families.get(&FontFamily::Proportional).cloned().unwrap_or_default();
    for f in ["bold", "semibold"] {
        let fam = fonts.families.entry(FontFamily::Name(f.into())).or_default();
        for p in &prop {
            if !fam.contains(p) {
                fam.push(p.clone());
            }
        }
    }
    ctx.set_fonts(fonts);

    let mut style = (*ctx.style()).clone();
    style.spacing.item_spacing = vec2(8.0, 8.0);
    style.spacing.button_padding = vec2(12.0, 7.0);
    style.interaction.selectable_labels = false;
    let v = &mut style.visuals;
    *v = egui::Visuals::dark();
    v.panel_fill = Color32::TRANSPARENT;
    v.window_fill = Color32::from_rgb(21, 22, 29);
    v.window_stroke = Stroke::new(1.0, LINE2);
    v.window_corner_radius = CornerRadius::same(16);
    v.extreme_bg_color = Color32::from_rgb(15, 16, 21);
    v.override_text_color = Some(TEXT);
    v.selection.bg_fill = ACCENT;
    v.selection.stroke = Stroke::new(1.5, ACCENT);
    v.text_cursor.stroke = Stroke::new(1.5, ACCENT_TXT);
    v.widgets.inactive.bg_stroke = Stroke::new(1.0, LINE2);
    v.widgets.inactive.corner_radius = CornerRadius::same(9);
    v.widgets.hovered.corner_radius = CornerRadius::same(9);
    v.widgets.active.corner_radius = CornerRadius::same(9);
    v.widgets.hovered.bg_stroke = Stroke::new(1.0, Color32::from_rgb(60, 61, 75));
    v.widgets.active.bg_stroke = Stroke::new(1.5, ACCENT);
    style.text_styles.insert(egui::TextStyle::Body, reg(13.5));
    style.text_styles.insert(egui::TextStyle::Button, semi(13.0));
    ctx.set_style(style);
}

/// Soft radial glow (used for the purple background lights).
pub fn glow(p: &Painter, c: Pos2, r: f32, col: Color32) {
    let mut mesh = egui::Mesh::default();
    let n = 64;
    mesh.colored_vertex(c, col);
    for i in 0..=n {
        let a = i as f32 / n as f32 * std::f32::consts::TAU;
        mesh.colored_vertex(c + vec2(a.cos(), a.sin()) * r, Color32::TRANSPARENT);
    }
    for i in 0..n as u32 {
        mesh.add_triangle(0, i + 1, i + 2);
    }
    p.add(Shape::mesh(mesh));
}

/// Vertical gradient rect.
pub fn vgrad(p: &Painter, r: Rect, top: Color32, bot: Color32) {
    let mut mesh = egui::Mesh::default();
    mesh.colored_vertex(r.left_top(), top);
    mesh.colored_vertex(r.right_top(), top);
    mesh.colored_vertex(r.left_bottom(), bot);
    mesh.colored_vertex(r.right_bottom(), bot);
    mesh.add_triangle(0, 1, 2);
    mesh.add_triangle(1, 2, 3);
    p.add(Shape::mesh(mesh));
}

pub fn card() -> Frame {
    Frame::new()
        .fill(Color32::from_rgba_unmultiplied(20, 20, 30, 222))
        .stroke(Stroke::new(1.0, Color32::from_rgba_unmultiplied(255, 255, 255, 14)))
        .corner_radius(16)
        .inner_margin(Margin::same(16))
        .shadow(egui::Shadow { offset: [0, 8], blur: 24, spread: 0, color: Color32::from_black_alpha(50) })
}

/// Soft accent outline that fades in while the pointer is over `rect`.
pub fn hover_outline(ui: &Ui, id: Id, rect: Rect, radius: u8) {
    let over = ui.rect_contains_pointer(rect);
    let h = hover_amt(ui.ctx(), id, over);
    if h > 0.01 {
        ui.painter().rect_stroke(rect, radius, Stroke::new(1.0, Color32::from_rgba_unmultiplied(150, 120, 255, (110.0 * h) as u8)), StrokeKind::Inside);
    }
}

pub fn section_label(ui: &mut Ui, text: &str) {
    let g = grad_galley(ui.painter(), &text.to_uppercase(), bold(11.0), 1.6, |t| SAND.lerp_to_gamma(PINK, t));
    let (r, _) = ui.allocate_exact_size(g.size(), Sense::hover());
    ui.painter().galley(r.min, g, TEXT);
    ui.add_space(4.0);
}

#[derive(Clone, Copy, PartialEq)]
pub enum Btn {
    Primary,
    Ghost,
    Text,
    Danger,
}

pub fn button(ui: &mut Ui, kind: Btn, icon: Option<Icon>, text: &str, enabled: bool) -> Response {
    button_sized(ui, kind, icon, text, enabled, 34.0)
}

pub fn button_sized(ui: &mut Ui, kind: Btn, icon: Option<Icon>, text: &str, enabled: bool, h: f32) -> Response {
    button_w(ui, kind, icon, text, enabled, h, 0.0)
}

/// Button with a minimum width (content stays left-aligned with padding, centred when wider).
pub fn button_w(ui: &mut Ui, kind: Btn, icon: Option<Icon>, text: &str, enabled: bool, h: f32, min_w: f32) -> Response {
    let font = semi(if h > 36.0 { 13.5 } else { 12.8 });
    let galley = ui.painter().layout_no_wrap(text.to_owned(), font.clone(), TEXT);
    let base_pad = if kind == Btn::Text { 10.0 } else { if h > 36.0 { 20.0 } else { 14.0 } };
    let icon_w = if icon.is_some() { 21.0 } else { 0.0 };
    let natural = galley.size().x + base_pad * 2.0 + icon_w;
    let pad = if min_w > natural { (min_w - galley.size().x - icon_w) / 2.0 } else { base_pad };
    let size = vec2(natural.max(min_w), h);
    let (rect, resp) = ui.allocate_exact_size(size, if enabled { Sense::click() } else { Sense::hover() });
    let ctx = ui.ctx().clone();
    let hv = hover_amt(&ctx, resp.id, enabled && resp.hovered());
    let press = smooth(&ctx, resp.id.with("press"), if enabled && resp.is_pointer_button_down_on() { 1.0 } else { 0.0 }, 30.0);
    let r = rect.shrink(press * 1.2).translate(vec2(0.0, press * 0.6));
    let p = ui.painter();
    let mut txt = TEXT;
    match kind {
        Btn::Primary => {
            if enabled {
                let ga = (18.0 + 26.0 * hv) as u8;
                p.add(brand_rrect(r.expand(1.5 + 2.5 * hv).translate(vec2(0.0, 1.5)), 12.0, Color32::from_rgba_unmultiplied(128, 100, 255, ga), Color32::from_rgba_unmultiplied(200, 80, 220, ga)));
                let a = GRAD_A.lerp_to_gamma(Color32::from_rgb(150, 126, 255), hv);
                let b = GRAD_B.lerp_to_gamma(Color32::from_rgb(214, 96, 226), hv);
                p.add(brand_rrect(r, 10.0, a, b));
                p.add(grad_rrect(r, 10.0, |_, ty| Color32::from_white_alpha(if ty < 0.5 { (22.0 * (1.0 - ty * 2.0)) as u8 } else { 0 })));
                if hv > 0.01 {
                    // light sweep across the button while hovered
                    let t = (ctx.input(|i| i.time) as f32 * 0.8).fract();
                    let x = r.left() - 40.0 + (r.width() + 80.0) * t;
                    let band = vec![pos2(x - 14.0, r.bottom()), pos2(x + 6.0, r.top()), pos2(x + 26.0, r.top()), pos2(x + 6.0, r.bottom())];
                    p.with_clip_rect(r.shrink(1.0)).add(Shape::convex_polygon(band, Color32::from_white_alpha((26.0 * hv) as u8), Stroke::NONE));
                    ctx.request_repaint();
                }
                p.rect_stroke(r, 10, Stroke::new(1.0, Color32::from_white_alpha(18)), StrokeKind::Inside);
                txt = Color32::WHITE;
            } else {
                p.rect(r, 10, Color32::from_rgb(34, 34, 46), Stroke::new(1.0, LINE2), StrokeKind::Inside);
                txt = DIM;
            }
        }
        Btn::Ghost => {
            let fill = PANEL3.lerp_to_gamma(Color32::from_rgb(42, 40, 60), hv);
            let stroke = LINE2.lerp_to_gamma(Color32::from_rgb(110, 92, 220), hv * 0.8);
            p.rect(r, 10, fill, Stroke::new(1.0, stroke), StrokeKind::Inside);
            if !enabled {
                txt = DIM;
            }
        }
        Btn::Text => {
            if hv > 0.01 {
                p.rect_filled(r, 9, Color32::from_white_alpha((11.0 * hv) as u8));
            }
            txt = if !enabled { DIM } else { MUTED.lerp_to_gamma(TEXT, hv) };
        }
        Btn::Danger => {
            if hv > 0.01 {
                p.rect_filled(r, 9, Color32::from_rgba_unmultiplied(248, 113, 113, (30.0 * hv) as u8));
            }
            txt = RED;
        }
    }
    let mut x = r.left() + pad;
    if let Some(ic) = icon {
        draw_icon(p, ic, Rect::from_center_size(pos2(x + 7.0, r.center().y), vec2(14.0, 14.0)), txt);
        x += icon_w;
    }
    p.text(pos2(x, r.center().y), Align2::LEFT_CENTER, text, font, txt);
    if enabled {
        resp.on_hover_cursor(egui::CursorIcon::PointingHand)
    } else {
        resp
    }
}

pub fn icon_button(ui: &mut Ui, ic: Icon, size: f32, tip: &str) -> Response {
    let (rect, resp) = ui.allocate_exact_size(vec2(size, size), Sense::click());
    let hv = hover_amt(ui.ctx(), resp.id, resp.hovered());
    if hv > 0.01 {
        ui.painter().rect_filled(rect, 9, Color32::from_white_alpha((14.0 * hv) as u8));
    }
    draw_icon(ui.painter(), ic, Rect::from_center_size(rect.center(), vec2(size * 0.48, size * 0.48)), MUTED.lerp_to_gamma(TEXT, hv));
    resp.on_hover_text(tip).on_hover_cursor(egui::CursorIcon::PointingHand)
}

#[derive(Clone, Copy, PartialEq)]
pub enum ChipKind {
    Grey,
    Green,
    Amber,
    Red,
    Purple,
    Live,
}

pub fn chip(ui: &mut Ui, kind: ChipKind, check: bool, spin: bool, text: &str) {
    let (bg, fg) = match kind {
        ChipKind::Grey => (Color32::from_white_alpha(12), MUTED),
        ChipKind::Green => (Color32::from_rgba_unmultiplied(61, 220, 151, 30), GREEN),
        ChipKind::Amber => (Color32::from_rgba_unmultiplied(245, 181, 68, 32), AMBER),
        ChipKind::Red => (Color32::from_rgba_unmultiplied(248, 113, 113, 30), RED),
        ChipKind::Purple => (Color32::from_rgba_unmultiplied(109, 93, 252, 42), ACCENT_TXT),
        ChipKind::Live => (GREEN, Color32::from_rgb(7, 38, 26)),
    };
    let font = semi(11.5);
    let g = ui.painter().layout_no_wrap(text.to_owned(), font.clone(), fg);
    let extra = if check || spin { 16.0 } else { 0.0 };
    let (rect, _) = ui.allocate_exact_size(vec2(g.size().x + 18.0 + extra, 22.0), Sense::hover());
    let p = ui.painter();
    if kind == ChipKind::Live {
        let pulse = 0.5 + 0.5 * (ui.input(|i| i.time) as f32 * 3.0).sin();
        p.rect_filled(rect.expand(2.0 + 2.0 * pulse), 8, Color32::from_rgba_unmultiplied(61, 220, 151, (40.0 * (1.0 - pulse)) as u8));
        ui.ctx().request_repaint_after(std::time::Duration::from_millis(33));
    }
    p.rect_filled(rect, 7, bg);
    let mut x = rect.left() + 9.0;
    if check {
        let c = pos2(x + 5.0, rect.center().y);
        p.line(vec![c + vec2(-4.0, 0.0), c + vec2(-1.0, 3.0), c + vec2(4.0, -3.0)], Stroke::new(1.8, fg));
        x += extra;
    } else if spin {
        let t = ui.input(|i| i.time) as f32;
        let c = pos2(x + 5.0, rect.center().y);
        let pts: Vec<Pos2> = (0..=20).map(|i| {
            let a = t * 6.0 + i as f32 / 20.0 * 4.5;
            c + vec2(a.cos(), a.sin()) * 4.5
        }).collect();
        p.line(pts, Stroke::new(1.8, fg));
        ui.ctx().request_repaint();
        x += extra;
    }
    p.text(pos2(x, rect.center().y), Align2::LEFT_CENTER, text, font, fg);
}

/// Image with rounded corners, exactly `size`.
pub fn img(ui: &mut Ui, tex: &egui::TextureHandle, size: f32, radius: u8) -> Response {
    ui.add(egui::Image::new(tex).fit_to_exact_size(Vec2::splat(size)).corner_radius(radius))
}

pub fn placeholder(ui: &mut Ui, size: f32, radius: u8) -> Response {
    let (rect, resp) = ui.allocate_exact_size(Vec2::splat(size), Sense::hover());
    ui.painter().rect(rect, radius, PANEL3, Stroke::NONE, StrokeKind::Inside);
    draw_icon(ui.painter(), Icon::Image, Rect::from_center_size(rect.center(), Vec2::splat(size * 0.26)), DIM);
    resp
}

pub fn switch(ui: &mut Ui, on: bool) -> Response {
    let (rect, resp) = ui.allocate_exact_size(vec2(36.0, 20.0), Sense::click());
    let t = smooth(ui.ctx(), resp.id.with("sw"), if on { 1.0 } else { 0.0 }, 16.0);
    let hv = hover_amt(ui.ctx(), resp.id, resp.hovered());
    let p = ui.painter();
    if t > 0.01 {
        p.rect_filled(rect.expand(3.0), 13, Color32::from_rgba_unmultiplied(150, 100, 255, (30.0 * t) as u8));
    }
    let off = Color32::from_rgb(42, 43, 55).lerp_to_gamma(Color32::from_rgb(56, 56, 72), hv);
    p.add(brand_rrect(rect, 10.0, off.lerp_to_gamma(GRAD_A, t), off.lerp_to_gamma(GRAD_B, t)));
    let knob = pos2(rect.left() + 10.0 + t * 16.0, rect.center().y);
    p.circle_filled(knob + vec2(0.0, 1.0), 7.5, Color32::from_black_alpha(50));
    p.circle_filled(knob, 7.0 + hv * 0.6, Color32::WHITE);
    resp.on_hover_cursor(egui::CursorIcon::PointingHand)
}

pub fn checkbox(ui: &mut Ui, on: bool) -> Response {
    let (rect, resp) = ui.allocate_exact_size(vec2(18.0, 18.0), Sense::click());
    let t = smooth(ui.ctx(), resp.id.with("cb"), if on { 1.0 } else { 0.0 }, 20.0);
    let p = ui.painter();
    p.rect(rect, 5, Color32::TRANSPARENT, Stroke::new(1.5, LINE2), StrokeKind::Inside);
    if t > 0.01 {
        let r = Rect::from_center_size(rect.center(), rect.size() * (0.6 + 0.4 * t));
        p.add(brand_rrect(r, 5.0, GRAD_A.gamma_multiply(t), GRAD_B.gamma_multiply(t)));
        let c = rect.center();
        let pts = [c + vec2(-4.0, 0.0), c + vec2(-1.0, 3.0), c + vec2(4.5, -3.5)];
        p.line(pts.to_vec(), Stroke::new(2.0, Color32::WHITE.gamma_multiply(t)));
    }
    resp.on_hover_cursor(egui::CursorIcon::PointingHand)
}

/// Roicon logo (the hourglass app icon) with a soft glow behind it.
pub fn logo(p: &Painter, rect: Rect) {
    let s = rect.width();
    if s >= 24.0 {
        glow(p, rect.center() + vec2(0.0, s * 0.12), s * 0.9, Color32::from_rgba_unmultiplied(244, 96, 164, 40));
    }
    if let Some(id) = LOGO.get() {
        p.image(*id, rect, Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)), Color32::WHITE);
    } else {
        p.rect_filled(rect, (s * 0.25) as u8, Color32::from_rgb(52, 30, 128));
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Icon {
    Plus,
    Calendar,
    Arrow,
    Pencil,
    Trash,
    Qr,
    Close,
    Cloud,
    Sliders,
    Image,
    Rocket,
    Refresh,
    Dots,
    External,
    Key,
}

pub fn draw_icon(p: &Painter, ic: Icon, r: Rect, c: Color32) {
    let st = Stroke::new(1.7, c);
    let (x0, y0, w, h) = (r.left(), r.top(), r.width(), r.height());
    let at = |fx: f32, fy: f32| pos2(x0 + fx * w, y0 + fy * h);
    match ic {
        Icon::Plus => {
            p.line_segment([at(0.5, 0.1), at(0.5, 0.9)], st);
            p.line_segment([at(0.1, 0.5), at(0.9, 0.5)], st);
        }
        Icon::Calendar => {
            p.rect_stroke(Rect::from_min_max(at(0.05, 0.15), at(0.95, 0.95)), 3, st, StrokeKind::Middle);
            p.line_segment([at(0.05, 0.4), at(0.95, 0.4)], st);
            p.line_segment([at(0.3, 0.02), at(0.3, 0.25)], st);
            p.line_segment([at(0.7, 0.02), at(0.7, 0.25)], st);
        }
        Icon::Arrow => {
            p.line_segment([at(0.05, 0.5), at(0.95, 0.5)], st);
            p.line(vec![at(0.6, 0.15), at(0.95, 0.5), at(0.6, 0.85)], st);
        }
        Icon::Pencil => {
            p.line(vec![at(0.1, 0.9), at(0.15, 0.65), at(0.7, 0.1), at(0.9, 0.3), at(0.35, 0.85), at(0.1, 0.9)], st);
        }
        Icon::Trash => {
            p.line_segment([at(0.08, 0.22), at(0.92, 0.22)], st);
            p.line(vec![at(0.2, 0.22), at(0.27, 0.95), at(0.73, 0.95), at(0.8, 0.22)], st);
            p.line(vec![at(0.35, 0.22), at(0.38, 0.05), at(0.62, 0.05), at(0.65, 0.22)], st);
        }
        Icon::Qr => {
            for (fx, fy) in [(0.0, 0.0), (0.58, 0.0), (0.0, 0.58)] {
                p.rect_stroke(Rect::from_min_size(at(fx, fy), vec2(w * 0.42, h * 0.42)), 2, st, StrokeKind::Middle);
            }
            p.rect_filled(Rect::from_min_size(at(0.62, 0.62), vec2(w * 0.14, h * 0.14)), 0, c);
            p.rect_filled(Rect::from_min_size(at(0.84, 0.84), vec2(w * 0.14, h * 0.14)), 0, c);
        }
        Icon::Close => {
            p.line_segment([at(0.15, 0.15), at(0.85, 0.85)], st);
            p.line_segment([at(0.85, 0.15), at(0.15, 0.85)], st);
        }
        Icon::Cloud => {
            let pts: Vec<Pos2> = (0..=24).map(|i| {
                let a = std::f32::consts::PI * (1.0 + i as f32 / 24.0);
                at(0.5 + 0.28 * a.cos(), 0.55 + 0.32 * a.sin())
            }).collect();
            p.line(pts, st);
            p.line(vec![at(0.22, 0.55), at(0.1, 0.62), at(0.1, 0.8), at(0.9, 0.8), at(0.9, 0.62), at(0.78, 0.55)], st);
            p.line(vec![at(0.5, 0.75), at(0.5, 0.42)], st);
            p.line(vec![at(0.38, 0.53), at(0.5, 0.42), at(0.62, 0.53)], st);
        }
        Icon::Sliders => {
            for (fy, fx) in [(0.2, 0.65), (0.5, 0.3), (0.8, 0.55)] {
                p.line_segment([at(0.0, fy), at(1.0, fy)], st);
                p.circle_filled(at(fx, fy), w * 0.12, c);
            }
        }
        Icon::Image => {
            p.rect_stroke(r, 3, st, StrokeKind::Middle);
            p.line(vec![at(0.05, 0.8), at(0.38, 0.5), at(0.6, 0.7), at(0.75, 0.58), at(0.95, 0.78)], st);
            p.circle_stroke(at(0.7, 0.3), w * 0.09, st);
        }
        Icon::Rocket => {
            p.line(vec![at(0.5, 0.0), at(0.75, 0.35), at(0.7, 0.75), at(0.3, 0.75), at(0.25, 0.35), at(0.5, 0.0)], st);
            p.line(vec![at(0.3, 0.55), at(0.08, 0.8), at(0.3, 0.75)], st);
            p.line(vec![at(0.7, 0.55), at(0.92, 0.8), at(0.7, 0.75)], st);
            p.line_segment([at(0.5, 0.85), at(0.5, 1.0)], st);
        }
        Icon::Refresh => {
            let pts: Vec<Pos2> = (0..=20).map(|i| {
                let a = 0.4 + i as f32 / 20.0 * 5.0;
                at(0.5 + 0.4 * a.cos(), 0.5 + 0.4 * a.sin())
            }).collect();
            let end = *pts.last().unwrap();
            p.line(pts, st);
            p.line(vec![end + vec2(-w * 0.25, -h * 0.02), end, end + vec2(-w * 0.02, -h * 0.25)], st);
        }
        Icon::Dots => {
            for fx in [0.15, 0.5, 0.85] {
                p.circle_filled(at(fx, 0.5), w * 0.08, c);
            }
        }
        Icon::External => {
            p.line(vec![at(0.45, 0.1), at(0.1, 0.1), at(0.1, 0.9), at(0.9, 0.9), at(0.9, 0.55)], st);
            p.line_segment([at(0.45, 0.55), at(0.95, 0.05)], st);
            p.line(vec![at(0.6, 0.05), at(0.95, 0.05), at(0.95, 0.4)], st);
        }
        Icon::Key => {
            p.circle_stroke(at(0.3, 0.6), w * 0.22, st);
            p.line(vec![at(0.46, 0.44), at(0.92, 0.0)], st);
            p.line(vec![at(0.75, 0.17), at(0.9, 0.32)], st);
        }
    }
}

/// Plain clickable text link.
pub fn link(ui: &mut Ui, text: &str) -> Response {
    let resp = ui.add(egui::Label::new(egui::RichText::new(text).font(semi(12.0)).color(ACCENT_TXT)).sense(Sense::click()));
    resp.on_hover_cursor(egui::CursorIcon::PointingHand)
}
