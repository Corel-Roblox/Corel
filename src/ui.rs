//! Theme, fonts and small custom widgets matching the Roicon look.

use egui::{pos2, vec2, Align2, Color32, CornerRadius, FontFamily, FontId, Frame, Margin, Painter, Pos2, Rect, Response, Sense, Shape, Stroke, StrokeKind, Ui, Vec2};
use std::sync::Arc;

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
    add("ui-symbols", &["seguisym.ttf"], FontFamily::Proportional);
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
    Frame::new().fill(PANEL).stroke(Stroke::new(1.0, LINE)).corner_radius(14).inner_margin(Margin::same(16))
}

pub fn section_label(ui: &mut Ui, text: &str) {
    ui.label(egui::RichText::new(text.to_uppercase()).font(semi(11.0)).color(DIM).extra_letter_spacing(1.3));
    ui.add_space(2.0);
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
    let hovered = enabled && resp.hovered();
    let pressed = enabled && resp.is_pointer_button_down_on();
    let r = rect.translate(vec2(0.0, if pressed { 1.0 } else { 0.0 }));
    let p = ui.painter();
    let mut txt = TEXT;
    match kind {
        Btn::Primary => {
            if enabled {
                p.rect_filled(r.expand(4.0).translate(vec2(0.0, 4.0)), 12, Color32::from_rgba_unmultiplied(109, 93, 252, 40));
            }
            let (a, b) = if hovered { (Color32::from_rgb(134, 120, 255), Color32::from_rgb(107, 92, 251)) } else { (ACCENT_HI, Color32::from_rgb(98, 82, 242)) };
            let mut shape = egui::epaint::RectShape::filled(r, 9, b);
            shape.fill = b;
            p.add(shape);
            p.rect_filled(Rect::from_min_max(r.min, pos2(r.max.x, r.center().y)), CornerRadius { nw: 9, ne: 9, sw: 0, se: 0 }, a.gamma_multiply(0.55));
            if !enabled {
                p.rect_filled(r, 9, Color32::from_black_alpha(140));
                txt = Color32::from_gray(170);
            } else {
                txt = Color32::WHITE;
            }
        }
        Btn::Ghost => {
            p.rect(r, 9, if hovered { Color32::from_rgb(36, 37, 47) } else { PANEL3 }, Stroke::new(1.0, LINE2), StrokeKind::Inside);
            if !enabled {
                txt = DIM;
            }
        }
        Btn::Text => {
            if hovered {
                p.rect_filled(r, 8, Color32::from_white_alpha(10));
            }
            txt = if !enabled { DIM } else if hovered { TEXT } else { MUTED };
        }
        Btn::Danger => {
            if hovered {
                p.rect_filled(r, 8, Color32::from_rgba_unmultiplied(248, 113, 113, 28));
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
    let hov = resp.hovered();
    if hov {
        ui.painter().rect_filled(rect, 8, Color32::from_white_alpha(12));
    }
    draw_icon(ui.painter(), ic, Rect::from_center_size(rect.center(), vec2(size * 0.48, size * 0.48)), if hov { TEXT } else { MUTED });
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
    p.rect_filled(rect, 6, bg);
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
    let t = ui.ctx().animate_bool(resp.id, on);
    let p = ui.painter();
    p.rect_filled(rect, 10, Color32::from_rgb(42, 43, 55).lerp_to_gamma(ACCENT, t));
    p.circle_filled(pos2(rect.left() + 10.0 + t * 16.0, rect.center().y), 7.0, Color32::WHITE);
    resp.on_hover_cursor(egui::CursorIcon::PointingHand)
}

pub fn checkbox(ui: &mut Ui, on: bool) -> Response {
    let (rect, resp) = ui.allocate_exact_size(vec2(18.0, 18.0), Sense::click());
    let p = ui.painter();
    if on {
        p.rect_filled(rect, 5, ACCENT);
        let c = rect.center();
        p.line(vec![c + vec2(-4.0, 0.0), c + vec2(-1.0, 3.0), c + vec2(4.5, -3.5)], Stroke::new(2.0, Color32::WHITE));
    } else {
        p.rect(rect, 5, Color32::TRANSPARENT, Stroke::new(1.5, LINE2), StrokeKind::Inside);
    }
    resp.on_hover_cursor(egui::CursorIcon::PointingHand)
}

/// Roicon logo: purple tile, countdown ring, bold R.
pub fn logo(p: &Painter, rect: Rect) {
    let s = rect.width();
    let cr = (s * 0.27) as u8;
    p.rect_filled(rect.expand(s * 0.12).translate(vec2(0.0, s * 0.1)), (s * 0.4) as u8, Color32::from_rgba_unmultiplied(109, 93, 252, 50));
    p.rect_filled(rect, cr, Color32::from_rgb(108, 92, 245));
    p.rect_filled(Rect::from_min_max(rect.min, pos2(rect.max.x, rect.center().y)), CornerRadius { nw: cr, ne: cr, sw: 0, se: 0 }, Color32::from_rgba_unmultiplied(150, 135, 255, 70));
    let c = rect.center();
    let rad = s * 0.335;
    let w = (s * 0.075).max(1.3);
    p.circle_stroke(c, rad, Stroke::new(w, Color32::from_white_alpha(60)));
    let start = -std::f32::consts::FRAC_PI_2;
    let sweep = std::f32::consts::TAU * 0.78;
    let pts: Vec<Pos2> = (0..=64).map(|i| {
        let a = start + sweep * i as f32 / 64.0;
        c + vec2(a.cos(), a.sin()) * rad
    }).collect();
    p.circle_filled(pts[0], w / 2.0, Color32::WHITE);
    p.circle_filled(*pts.last().unwrap(), w / 2.0, Color32::WHITE);
    p.line(pts, Stroke::new(w, Color32::WHITE));
    p.rect_filled(Rect::from_center_size(c, Vec2::splat(s * 0.35)), (s * 0.075) as u8, Color32::WHITE);
    if s >= 20.0 {
        p.text(c + vec2(s * 0.004, s * 0.01), Align2::CENTER_CENTER, "R", FontId::new(s * 0.27, FontFamily::Name("bold".into())), Color32::from_rgb(98, 82, 242));
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
