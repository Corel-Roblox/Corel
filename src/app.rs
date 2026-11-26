//! The Roicon window: sidebar, Update / Timers / Settings tabs, modals.

use crate::images;
use crate::relay::{self, Relay};
use crate::roblox;
use crate::scheduler::{Scheduler, StepInput};
use crate::store::*;
use crate::ui::{self, Btn, ChipKind, Icon, ACCENT, ACCENT_TXT, AMBER, DIM, GREEN, LINE, LINE2, MUTED, PANEL, PANEL3, RED, TEXT};
use chrono::{Datelike, Duration as CDur, Local, NaiveDate, NaiveTime, TimeZone, Timelike};
use egui::{pos2, vec2, Align, Align2, Color32, Context, Frame, Id, Layout, Margin, Pos2, Rect, RichText, Sense, Stroke, StrokeKind, TextureHandle, Ui, Vec2, ViewportCommand};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;

#[derive(PartialEq, Clone, Copy)]
enum Tab {
    Update,
    Timers,
    Settings,
}

#[derive(Clone, PartialEq, Debug)]
enum Drop {
    Current,
    New,
    Overlay(String),
}

enum Modal {
    AddExp { input: String, busy: bool, err: String },
    Account { key: String, busy: bool, err: String, cid: String, secret: String, show_setup: bool, show_key: bool },
    Date { exp: String, date: String, time: String, err: String },
    Timer { exp: String, id: Option<String>, hours: String, label: String, overlay: Option<String>, err: String },
    Phone { url: String, qr: TextureHandle },
    ConfirmCancel { exp: String },
    ConfirmRemove { exp: String },
    QuitConfirm,
}

enum Msg {
    Toast(String, bool),
    AddDone(Result<(), String>),
    KeyDone(Result<(), String>),
    StartDone(Result<(), String>),
    SignInDone(Result<(), String>),
    Idle(String),
}

struct Particle {
    p: Pos2,
    v: Vec2,
    rot: f32,
    vr: f32,
    col: Color32,
    life: f32,
    size: Vec2,
}

pub struct App {
    store: Store,
    sched: Scheduler,
    relay: Relay,
    tab: Tab,
    modal: Option<Modal>,
    tex: HashMap<String, TextureHandle>,
    comp: HashMap<String, TextureHandle>,
    toasts: Vec<(String, bool, f64)>,
    confetti: Vec<Particle>,
    tx: Sender<Msg>,
    rx: Receiver<Msg>,
    busy: HashSet<String>,
    drop_rects: Vec<(Drop, Rect)>,
    start_btn: Option<Rect>,
    quitting: bool,
    _tray: Option<tray_icon::TrayIcon>,
    signin: Option<Arc<AtomicBool>>,
}

// ---------------- time formatting ----------------

fn local(ms: i64) -> chrono::DateTime<Local> {
    Local.timestamp_millis_opt(ms).single().unwrap_or_else(Local::now)
}
fn fmt_when(ms: i64) -> String {
    local(ms).format("%A, %B %-d at %H:%M").to_string()
}
fn fmt_short(ms: i64) -> String {
    local(ms).format("%a, %b %-d, %H:%M").to_string()
}
fn fmt_left(ms: i64) -> String {
    if ms <= 0 {
        return "now".into();
    }
    let s = ms / 1000;
    let (d, h, m, sec) = (s / 86400, s % 86400 / 3600, s % 3600 / 60, s % 60);
    if d > 0 {
        format!("{d}d {h}h")
    } else if h > 0 {
        format!("{h}h {m:02}m")
    } else {
        format!("{m}m {sec:02}s")
    }
}

fn exp_status(e: &Experience, now: i64) -> (String, Color32) {
    match &e.update {
        Some(u) if u.status == Status::Preparing => ("Uploading icons…".into(), ACCENT_TXT),
        Some(u) if u.status == Status::Restoring => ("Restoring original icon…".into(), AMBER),
        Some(u) if u.status == Status::Scheduled => match u.next_step() {
            Some(s) if s.at.unwrap_or(now) <= now => (if s.apply == Apply::Waiting { format!("{} waiting for approval", s.label) } else { format!("{} going up now", s.label) }, ACCENT_TXT),
            Some(s) => (format!("{} in {}", s.label, fmt_left(s.at.unwrap_or(now) - now)), ACCENT_TXT),
            None => ("Finishing…".into(), ACCENT_TXT),
        },
        Some(u) if u.status == Status::Done => ("Update complete".into(), GREEN),
        Some(u) if u.status == Status::Cancelled => ("Update cancelled".into(), DIM),
        _ => match e.planned_at {
            Some(t) if t > now => (format!("Planned for {}", local(t).format("%a %H:%M")), DIM),
            _ => ("No update scheduled".into(), DIM),
        },
    }
}

fn pick_image() -> Option<Vec<u8>> {
    rfd::FileDialog::new().add_filter("Images", &["png", "jpg", "jpeg", "webp"]).pick_file().and_then(|p| std::fs::read(p).ok())
}

impl App {
    pub fn new(cc: &eframe::CreationContext<'_>, store: Store, sched: Scheduler) -> Self {
        ui::setup(&cc.egui_ctx);
        store.set_ctx(cc.egui_ctx.clone());
        {
            use raw_window_handle::{HasWindowHandle, RawWindowHandle};
            if let Ok(h) = cc.window_handle() {
                if let RawWindowHandle::Win32(w) = h.as_raw() {
                    crate::HWND.store(w.hwnd.get(), std::sync::atomic::Ordering::Relaxed);
                }
            }
        }
        let (tx, rx) = channel();
        let relay = Relay::new(store.clone());
        let tray = Self::make_tray(store.clone());
        Self {
            store,
            sched,
            relay,
            tab: Tab::Update,
            modal: None,
            tex: HashMap::new(),
            comp: HashMap::new(),
            toasts: vec![],
            confetti: vec![],
            tx,
            rx,
            busy: HashSet::new(),
            drop_rects: vec![],
            start_btn: None,
            quitting: false,
            _tray: tray,
            signin: None,
        }
    }

    fn make_tray(store: Store) -> Option<tray_icon::TrayIcon> {
        use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
        use tray_icon::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
        let menu = Menu::new();
        let open = MenuItem::with_id("open", "Open Roicon", true, None);
        let quit = MenuItem::with_id("quit", "Quit", true, None);
        menu.append_items(&[&open, &PredefinedMenuItem::separator(), &quit]).ok()?;
        let icon = images::app_icon(32);
        let tray = TrayIconBuilder::new()
            .with_menu(Box::new(menu))
            .with_menu_on_left_click(false)
            .with_tooltip("Roicon")
            .with_icon(tray_icon::Icon::from_rgba(icon.into_raw(), 32, 32).ok()?)
            .build()
            .ok()?;
        TrayIconEvent::set_event_handler(Some(|e: TrayIconEvent| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                crate::show_window();
            }
        }));
        MenuEvent::set_event_handler(Some(move |e: MenuEvent| {
            if e.id == "open" {
                crate::show_window();
            } else if e.id == "quit" {
                if store.lock().any_active() {
                    let r = rfd::MessageDialog::new()
                        .set_title("Roicon")
                        .set_level(rfd::MessageLevel::Warning)
                        .set_description("An update is scheduled. If you quit, icons will not change until you open Roicon again.")
                        .set_buttons(rfd::MessageButtons::OkCancelCustom("Quit anyway".into(), "Keep running".into()))
                        .show();
                    if r != rfd::MessageDialogResult::Custom("Quit anyway".into()) {
                        return;
                    }
                }
                std::process::exit(0);
            }
        }));
        Some(tray)
    }

    // ---------------- helpers ----------------

    fn toast(&mut self, ctx: &Context, msg: impl Into<String>, err: bool) {
        self.toasts.push((msg.into(), err, ctx.input(|i| i.time)));
    }

    fn tex(&mut self, ctx: &Context, name: &str) -> Option<TextureHandle> {
        if let Some(t) = self.tex.get(name) {
            return Some(t.clone());
        }
        let bytes = self.store.read_image(name)?;
        let img = images::decode(&bytes).ok()?;
        let t = ctx.load_texture(name, egui::ColorImage::from_rgba_unmultiplied([img.width() as usize, img.height() as usize], img.as_raw()), egui::TextureOptions::LINEAR);
        self.tex.insert(name.to_owned(), t.clone());
        Some(t)
    }

    fn comp_tex(&mut self, ctx: &Context, base: Option<&String>, t: &Timer) -> TextureHandle {
        let key = format!("{:?}|{:?}|{}", base, t.overlay, t.label);
        if let Some(h) = self.comp.get(&key) {
            return h.clone();
        }
        let b = base.and_then(|n| self.store.read_image(n));
        let o = t.overlay.as_ref().and_then(|n| self.store.read_image(n));
        let img = images::composite(b.as_deref(), o.as_deref(), &t.label);
        let h = ctx.load_texture(&key, egui::ColorImage::from_rgba_unmultiplied([img.width() as usize, img.height() as usize], img.as_raw()), egui::TextureOptions::LINEAR);
        self.comp.insert(key, h.clone());
        h
    }

    fn bg<F: FnOnce(&Store) -> Result<String, String> + Send + 'static>(&mut self, busy_key: &str, f: F) {
        if !self.busy.insert(busy_key.to_owned()) {
            return;
        }
        let (tx, store, key) = (self.tx.clone(), self.store.clone(), busy_key.to_owned());
        std::thread::spawn(move || {
            let r = f(&store);
            let _ = tx.send(match r {
                Ok(m) if m.is_empty() => Msg::Idle(key.clone()),
                Ok(m) => Msg::Toast(m, false),
                Err(m) => Msg::Toast(m, true),
            });
            let _ = tx.send(Msg::Idle(key));
            store.update(|_| ());
        });
    }

    fn set_image(&mut self, ctx: &Context, exp: &str, target: Drop, bytes: Vec<u8>) {
        let processed = match &target {
            Drop::Overlay(_) => images::fit_overlay(&bytes),
            _ => images::square_icon(&bytes),
        };
        match processed {
            Ok(png) => {
                let name = self.store.put_image(&png);
                self.store.update(|d| {
                    if let Some(e) = d.exp_mut(exp) {
                        match &target {
                            Drop::Current => e.current_icon = Some(name.clone()),
                            Drop::New => e.new_icon = Some(name.clone()),
                            Drop::Overlay(tid) => {
                                if let Some(t) = e.timers.iter_mut().find(|t| &t.id == tid) {
                                    t.overlay = Some(name.clone());
                                }
                            }
                        }
                    }
                });
            }
            Err(e) => self.toast(ctx, e, true),
        }
    }

    fn burst(&mut self, at: Pos2) {
        let cols = [Color32::from_rgb(124, 108, 255), Color32::from_rgb(91, 140, 255), Color32::from_rgb(61, 220, 151), Color32::from_rgb(245, 181, 68), Color32::from_rgb(248, 113, 113), Color32::WHITE];
        let mut rng = rand::rng();
        use rand::Rng;
        for _ in 0..140 {
            let a: f32 = rng.random_range(-2.7..-0.45);
            let sp: f32 = rng.random_range(260.0..720.0);
            self.confetti.push(Particle {
                p: at,
                v: vec2(a.cos() * sp, a.sin() * sp),
                rot: rng.random_range(0.0..6.3),
                vr: rng.random_range(-12.0..12.0),
                col: cols[rng.random_range(0..cols.len())],
                life: rng.random_range(1.2..2.2),
                size: vec2(rng.random_range(5.0..9.0), rng.random_range(3.0..5.0)),
            });
        }
    }

    // ---------------- start / add / key ----------------

    fn start_update(&mut self, e: &Experience) {
        let Some(at) = e.planned_at else { return };
        let (eid, timers, base, new_icon) = (e.id.clone(), e.timers.clone(), e.current_icon.clone(), e.new_icon.clone());
        let (tx, store, sched) = (self.tx.clone(), self.store.clone(), self.sched.clone());
        self.busy.insert("start".into());
        std::thread::spawn(move || {
            let res = (|| {
                let base_png = base.as_ref().and_then(|n| store.read_image(n));
                let new_png = new_icon.as_ref().and_then(|n| store.read_image(n)).ok_or("Choose a new icon first.")?;
                let mut ts = timers.clone();
                ts.sort_by(|a, b| b.hours.partial_cmp(&a.hours).unwrap_or(std::cmp::Ordering::Equal));
                let mut steps: Vec<StepInput> = ts
                    .iter()
                    .map(|t| {
                        let o = t.overlay.as_ref().and_then(|n| store.read_image(n));
                        let img = images::composite(base_png.as_deref(), o.as_deref(), &t.label);
                        StepInput { key: t.id.clone(), label: t.tag(), at: at - (t.hours * 3_600_000.0) as i64, png: images::encode_png(&img) }
                    })
                    .collect();
                steps.push(StepInput { key: "new".into(), label: "New icon".into(), at, png: new_png });
                sched.start_update(&eid, at, steps, base_png)
            })();
            let _ = tx.send(Msg::StartDone(res));
        });
    }

    fn add_experience(&mut self, input: String) {
        let (tx, store) = (self.tx.clone(), self.store.clone());
        std::thread::spawn(move || {
            let res = (|| -> Result<(), String> {
                let uid_ = roblox::universe_from_input(&input).map_err(|e| e.msg)?;
                if store.lock().experiences.iter().any(|e| e.universe_id == uid_) {
                    return Err("That experience is already in your list.".into());
                }
                let g = roblox::get_game(&uid_).map_err(|e| e.msg)?;
                let places = roblox::get_places(&uid_, &g.root_place_id);
                let rating = roblox::get_rating(&uid_);
                let icon = roblox::get_game_icon_png(&uid_).ok().map(|b| store.put_image(&b));
                store.update(|d| {
                    let e = Experience {
                        id: uid(),
                        universe_id: g.universe_id.clone(),
                        root_place_id: g.root_place_id.clone(),
                        name: g.name.clone(),
                        creator: Creator { kind: g.creator_kind.clone(), id: g.creator_id.clone(), name: g.creator_name.clone() },
                        rating,
                        playing: g.playing,
                        places: places.iter().map(|(id, name)| Place { id: id.clone(), name: name.clone(), enabled: true }).collect(),
                        current_icon: icon,
                        new_icon: None,
                        timers: default_timers(),
                        planned_at: None,
                        update: None,
                        history: vec![],
                    };
                    d.selected = Some(e.id.clone());
                    d.experiences.push(e);
                });
                Ok(())
            })();
            let _ = tx.send(Msg::AddDone(res));
        });
    }

    fn save_key(&mut self, key: String) {
        let (tx, store) = (self.tx.clone(), self.store.clone());
        std::thread::spawn(move || {
            let res = (|| -> Result<(), String> {
                let key = key.trim().to_owned();
                if key.len() < 20 {
                    return Err("That doesn't look like an Open Cloud API key.".into());
                }
                let info = match roblox::introspect_key(&key) {
                    Ok(v) => Some(v),
                    Err(e) if e.status == 400 || e.status == 401 => return Err("Roblox did not accept this API key. Check it was copied fully and is enabled.".into()),
                    Err(_) => None,
                };
                if let Some(v) = &info {
                    if v["enabled"].as_bool() == Some(false) {
                        return Err("This API key is disabled on Roblox.".into());
                    }
                    if v["expired"].as_bool() == Some(true) {
                        return Err("This API key has expired.".into());
                    }
                }
                store.set_api_key(&key)?;
                let mut acct = Account { key_name: info.as_ref().and_then(|v| v["name"].as_str().map(str::to_owned)), method: "apikey".into(), ..Default::default() };
                let user_id = info.as_ref().and_then(|v| v["authorizedUserId"].as_u64().or(v["userId"].as_u64()).or(v["ownerId"].as_u64()).map(|x| x.to_string()).or(v["authorizedUserId"].as_str().map(str::to_owned)));
                if let Some(uid_) = user_id {
                    if let Ok(u) = roblox::get_user(&uid_) {
                        acct.user_id = Some(u.id);
                        acct.name = Some(u.name);
                        acct.display_name = Some(u.display_name);
                    }
                }
                if !store.uses_oauth() {
                    store.update(|d| d.account = Some(acct));
                }
                Ok(())
            })();
            let _ = tx.send(Msg::KeyDone(res));
        });
    }

    // ---------------- frame ----------------

    fn handle_msgs(&mut self, ctx: &Context) {
        while let Ok(m) = self.rx.try_recv() {
            match m {
                Msg::Toast(t, e) => self.toast(ctx, t, e),
                Msg::Idle(k) => {
                    self.busy.remove(&k);
                }
                Msg::AddDone(r) => match r {
                    Ok(()) => {
                        self.modal = None;
                        self.tab = Tab::Update;
                        self.toast(ctx, "Experience added.", false);
                    }
                    Err(e) => {
                        if let Some(Modal::AddExp { busy, err, .. }) = &mut self.modal {
                            *busy = false;
                            *err = e;
                        }
                    }
                },
                Msg::KeyDone(r) => match r {
                    Ok(()) => {
                        if let Some(Modal::Account { busy, err, key, .. }) = &mut self.modal {
                            *busy = false;
                            err.clear();
                            key.clear();
                        }
                        self.toast(ctx, "API key saved. You're connected to Roblox.", false);
                    }
                    Err(e) => {
                        if let Some(Modal::Account { busy, err, .. }) = &mut self.modal {
                            *busy = false;
                            *err = e;
                        }
                    }
                },
                Msg::SignInDone(r) => {
                    self.signin = None;
                    match r {
                        Ok(()) => {
                            let who = self.store.lock().account.as_ref().and_then(|a| a.name.clone()).unwrap_or_default();
                            self.toast(ctx, if who.is_empty() { "Connected to Roblox.".to_string() } else { format!("Connected to Roblox as @{who}.") }, false);
                        }
                        Err(e) if e == "cancelled" => {}
                        Err(e) => {
                            if let Some(Modal::Account { err, .. }) = &mut self.modal {
                                *err = e.clone();
                            }
                            self.toast(ctx, e, true);
                        }
                    }
                }
                Msg::StartDone(r) => {
                    self.busy.remove("start");
                    match r {
                        Ok(()) => {
                            let at = self.start_btn.map(|r| r.center()).unwrap_or(ctx.screen_rect().center());
                            self.burst(at);
                            self.toast(ctx, "Update started. Uploading icons to Roblox…", false);
                        }
                        Err(e) => self.toast(ctx, e, true),
                    }
                }
            }
        }
    }

    fn handle_close(&mut self, ctx: &Context, data: &Data) {
        if !ctx.input(|i| i.viewport().close_requested()) || self.quitting {
            return;
        }
        if data.settings.close_to_tray {
            ctx.send_viewport_cmd(ViewportCommand::CancelClose);
            crate::hide_window();
            if !data.tray_hint_shown {
                self.store.update(|d| d.tray_hint_shown = true);
                crate::notify("Roicon is still running", "Scheduled icons will change on time. Find it in the system tray.");
            }
        } else if data.any_active() {
            ctx.send_viewport_cmd(ViewportCommand::CancelClose);
            self.modal = Some(Modal::QuitConfirm);
        }
    }

    fn resize_edges(&self, ctx: &Context) {
        if ctx.input(|i| i.viewport().maximized.unwrap_or(false)) {
            return;
        }
        let Some(p) = ctx.input(|i| i.pointer.latest_pos()) else { return };
        let r = ctx.screen_rect();
        let m = 5.0;
        let (l, rt, t, b) = (p.x < r.left() + m, p.x > r.right() - m, p.y < r.top() + m, p.y > r.bottom() - m);
        use egui::viewport::ResizeDirection as D;
        let dir = match (l, rt, t, b) {
            (true, _, true, _) => Some(D::NorthWest),
            (_, true, true, _) => Some(D::NorthEast),
            (true, _, _, true) => Some(D::SouthWest),
            (_, true, _, true) => Some(D::SouthEast),
            (true, ..) => Some(D::West),
            (_, true, ..) => Some(D::East),
            (_, _, true, _) => Some(D::North),
            (_, _, _, true) => Some(D::South),
            _ => None,
        };
        if let Some(d) = dir {
            let icon = match d {
                D::West | D::East => egui::CursorIcon::ResizeHorizontal,
                D::North | D::South => egui::CursorIcon::ResizeVertical,
                D::NorthWest | D::SouthEast => egui::CursorIcon::ResizeNwSe,
                _ => egui::CursorIcon::ResizeNeSw,
            };
            ctx.set_cursor_icon(icon);
            if ctx.input(|i| i.pointer.primary_pressed()) {
                ctx.send_viewport_cmd(ViewportCommand::BeginResize(d));
            }
        }
    }

    fn titlebar(&mut self, ctx: &Context) {
        egui::TopBottomPanel::top("titlebar").exact_height(36.0).frame(Frame::NONE).show(ctx, |ui| {
            let rect = ui.max_rect();
            let drag = ui.interact(rect, Id::new("titlebar-drag"), Sense::click_and_drag());
            if drag.drag_started_by(egui::PointerButton::Primary) {
                ctx.send_viewport_cmd(ViewportCommand::StartDrag);
            }
            if drag.double_clicked() {
                let max = ctx.input(|i| i.viewport().maximized.unwrap_or(false));
                ctx.send_viewport_cmd(ViewportCommand::Maximized(!max));
            }
            let p = ui.painter();
            ui::logo(p, Rect::from_center_size(pos2(rect.left() + 22.0, rect.center().y), Vec2::splat(16.0)));
            p.text(pos2(rect.left() + 38.0, rect.center().y), Align2::LEFT_CENTER, "Roicon", ui::reg(12.0), MUTED);
            let w = 46.0;
            let maxed = ctx.input(|i| i.viewport().maximized.unwrap_or(false));
            for (i, kind) in ["min", "max", "close"].iter().enumerate() {
                let r = Rect::from_min_size(pos2(rect.right() - w * (3 - i) as f32, rect.top()), vec2(w, 36.0));
                let resp = ui.interact(r, Id::new(("winbtn", i)), Sense::click());
                let hov = resp.hovered();
                let p = ui.painter();
                if hov {
                    p.rect_filled(r, 0, if *kind == "close" { Color32::from_rgb(229, 72, 77) } else { Color32::from_white_alpha(14) });
                }
                let c = if hov { TEXT } else { MUTED };
                let st = Stroke::new(1.1, c);
                let cc = r.center();
                match *kind {
                    "min" => {
                        p.line_segment([cc + vec2(-5.0, 0.0), cc + vec2(5.0, 0.0)], st);
                    }
                    "max" => {
                        p.rect_stroke(Rect::from_center_size(cc, Vec2::splat(if maxed { 8.0 } else { 9.0 })), 1, st, StrokeKind::Middle);
                    }
                    _ => {
                        p.line_segment([cc + vec2(-5.0, -5.0), cc + vec2(5.0, 5.0)], st);
                        p.line_segment([cc + vec2(5.0, -5.0), cc + vec2(-5.0, 5.0)], st);
                    }
                }
                if resp.clicked() {
                    match *kind {
                        "min" => ctx.send_viewport_cmd(ViewportCommand::Minimized(true)),
                        "max" => ctx.send_viewport_cmd(ViewportCommand::Maximized(!maxed)),
                        _ => ctx.send_viewport_cmd(ViewportCommand::Close),
                    }
                }
            }
        });
    }

    fn sidebar(&mut self, ctx: &Context, data: &Data, now: i64) {
        egui::SidePanel::left("side").exact_width(236.0).resizable(false).show_separator_line(false).frame(Frame::NONE.inner_margin(Margin { left: 10, right: 10, top: 6, bottom: 12 })).show(ctx, |ui| {
            let full = ui.max_rect();
            ui.painter().line_segment([pos2(full.right() + 10.0, full.top() - 6.0), pos2(full.right() + 10.0, full.bottom() + 12.0)], Stroke::new(1.0, LINE));
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                ui.add_space(8.0);
                ui::section_label(ui, "My experiences");
            });
            let footer_h = 112.0;
            egui::ScrollArea::vertical().max_height((ui.available_height() - footer_h).max(60.0)).auto_shrink([false, false]).show(ui, |ui| {
                if data.experiences.is_empty() {
                    ui.horizontal(|ui| {
                        ui.add_space(8.0);
                        ui.label(RichText::new("Nothing here yet.").color(DIM).size(12.5));
                    });
                }
                let sel = data.selected.clone().or_else(|| data.experiences.first().map(|e| e.id.clone()));
                for e in &data.experiences {
                    let active = sel.as_deref() == Some(&e.id);
                    let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 52.0), Sense::click());
                    let p = ui.painter().clone();
                    if active {
                        p.rect(rect, 10, PANEL3, Stroke::new(1.0, LINE2), StrokeKind::Inside);
                    } else if resp.hovered() {
                        p.rect_filled(rect, 10, Color32::from_white_alpha(8));
                    }
                    let tr = Rect::from_min_size(rect.min + vec2(9.0, 9.0), Vec2::splat(34.0));
                    let icon = e.update.as_ref().filter(|u| u.status.active()).and_then(|u| u.live_step().map(|s| s.image.clone())).or(e.current_icon.clone());
                    match icon.and_then(|n| self.tex(ctx, &n)) {
                        Some(t) => {
                            egui::Image::new(&t).corner_radius(8).paint_at(ui, tr);
                        }
                        None => {
                            p.rect_filled(tr, 8, PANEL3);
                        }
                    }
                    let tx = tr.right() + 10.0;
                    let maxw = rect.right() - tx - 8.0;
                    let name = elide(ui, &e.name, ui::semi(13.0), maxw);
                    p.text(pos2(tx, rect.top() + 17.0), Align2::LEFT_CENTER, name, ui::semi(13.0), TEXT);
                    let (st, col) = exp_status(e, now);
                    let st = elide(ui, &st, ui::reg(11.5), maxw);
                    p.text(pos2(tx, rect.top() + 35.0), Align2::LEFT_CENTER, st, ui::reg(11.5), col);
                    if resp.on_hover_cursor(egui::CursorIcon::PointingHand).clicked() {
                        let id = e.id.clone();
                        self.store.update(|d| d.selected = Some(id));
                        self.tab = Tab::Update;
                    }
                }
            });
            {
                let rem = ui.available_height() - 98.0;
                if rem > 0.0 {
                    ui.add_space(rem);
                }
                // account row
                let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 50.0), Sense::click());
                let p = ui.painter();
                if resp.hovered() {
                    p.rect_filled(rect, 10, Color32::from_white_alpha(7));
                }
                p.line_segment([rect.left_top() - vec2(0.0, 2.0), rect.right_top() - vec2(0.0, 2.0)], Stroke::new(1.0, LINE));
                let c = pos2(rect.left() + 23.0, rect.center().y);
                p.circle_filled(c, 15.0, ACCENT);
                let acct = data.account.as_ref();
                let has_key = self.store.has_credential();
                let name = acct.and_then(|a| a.display_name.clone().or(a.name.clone()).or(a.key_name.clone())).unwrap_or_else(|| if has_key { "Connected".into() } else { "Not connected".into() });
                let handle = acct.and_then(|a| a.name.clone().map(|n| format!("@{n}"))).unwrap_or_else(|| if has_key { "Roblox connected".into() } else { "Connect Roblox".into() });
                match acct.and_then(|a| a.avatar.clone()).and_then(|n| self.tex(ctx, &n)) {
                    Some(t) => {
                        p.circle_filled(c, 15.0, PANEL3);
                        egui::Image::new(&t).corner_radius(15).paint_at(ui, Rect::from_center_size(c, Vec2::splat(30.0)));
                    }
                    None => {
                        p.text(c, Align2::CENTER_CENTER, name.chars().next().unwrap_or('?').to_uppercase().to_string(), ui::bold(12.5), Color32::WHITE);
                    }
                }
                p.text(pos2(rect.left() + 46.0, rect.center().y - 8.0), Align2::LEFT_CENTER, &name, ui::semi(12.8), TEXT);
                p.text(pos2(rect.left() + 46.0, rect.center().y + 9.0), Align2::LEFT_CENTER, &handle, ui::reg(11.5), if has_key { DIM } else { ACCENT_TXT });
                ui::draw_icon(p, Icon::Dots, Rect::from_center_size(pos2(rect.right() - 16.0, rect.center().y), vec2(14.0, 14.0)), DIM);
                if resp.on_hover_cursor(egui::CursorIcon::PointingHand).clicked() {
                    self.modal = Some(self.account_modal());
                }
                ui.add_space(4.0);
                ui.horizontal(|ui| {
                    let w = ui.available_width() - 42.0;
                    let primary = ui::button_w(ui, Btn::Primary, Some(Icon::Plus), "Add experience", true, 36.0, w);
                    if primary.clicked() {
                        self.modal = Some(Modal::AddExp { input: String::new(), busy: false, err: String::new() });
                    }
                    if ui::icon_button(ui, Icon::Sliders, 34.0, "Settings").clicked() {
                        self.modal = Some(self.account_modal());
                    }
                });
            }
        });
    }

    fn central(&mut self, ctx: &Context, data: &Data, now: i64) {
        egui::CentralPanel::default().frame(Frame::NONE).show(ctx, |ui| {
            let sel = data.selected.as_ref().and_then(|id| data.exp(id)).or(data.experiences.first());
            let Some(e) = sel.cloned() else {
                self.welcome(ui, data);
                return;
            };
            self.header(ui, ctx, &e, now);
            let avail = ui.available_rect_before_wrap();
            let inner = Rect::from_min_max(avail.min + vec2(28.0, 0.0), avail.max - vec2(28.0, 0.0));
            ui.scope_builder(egui::UiBuilder::new().max_rect(inner).layout(Layout::top_down(Align::Min)), |ui| match self.tab {
                Tab::Update => {
                    if e.update.is_some() {
                        self.launch_view(ui, ctx, &e, now)
                    } else {
                        self.plan_view(ui, ctx, data, &e, now)
                    }
                }
                Tab::Timers => self.timers_view(ui, ctx, &e),
                Tab::Settings => self.settings_view(ui, ctx, &e),
            });
        });
    }

    fn header(&mut self, ui: &mut Ui, ctx: &Context, e: &Experience, now: i64) {
        Frame::NONE.inner_margin(Margin { left: 28, right: 28, top: 14, bottom: 16 }).show(ui, |ui| {
            ui.horizontal(|ui| {
                let icon = e.update.as_ref().filter(|u| u.status.active()).and_then(|u| u.live_step().map(|s| s.image.clone())).or(e.current_icon.clone());
                match icon.and_then(|n| self.tex(ctx, &n)) {
                    Some(t) => {
                        ui::img(ui, &t, 52.0, 12);
                    }
                    None => {
                        ui::placeholder(ui, 52.0, 12);
                    }
                }
                ui.add_space(4.0);
                ui.vertical(|ui| {
                    ui.add_space(5.0);
                    ui.label(RichText::new(&e.name).font(ui::bold(20.0)));
                    let (st, col) = exp_status(e, now);
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 0.0;
                        let en = e.enabled_places().len();
                        ui.label(RichText::new(format!("Universe {} · {}/{} place{} · ", e.universe_id, en, e.places.len(), if e.places.len() == 1 { "" } else { "s" })).size(12.5).color(DIM));
                        ui.label(RichText::new(st).size(12.5).color(if col == DIM { DIM } else { col }));
                    });
                });
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    Frame::new().fill(PANEL).stroke(Stroke::new(1.0, LINE)).corner_radius(11).inner_margin(Margin::same(4)).show(ui, |ui| {
                        ui.horizontal(|ui| {
                            ui.spacing_mut().item_spacing.x = 2.0;
                            // right-to-left parent: add in reverse so they read Update, Timers, Settings
                            for (t, name) in [(Tab::Settings, "Settings"), (Tab::Timers, "Timers"), (Tab::Update, "Update")] {
                                let on = self.tab == t;
                                let g = ui.painter().layout_no_wrap(name.into(), ui::semi(12.8), TEXT);
                                let (r, resp) = ui.allocate_exact_size(vec2(g.size().x + 28.0, 30.0), Sense::click());
                                if on {
                                    ui.painter().rect(r, 8, PANEL3, Stroke::new(1.0, LINE2), StrokeKind::Inside);
                                }
                                let c = if on || resp.hovered() { TEXT } else { MUTED };
                                ui.painter().text(r.center(), Align2::CENTER_CENTER, name, ui::semi(12.8), c);
                                if resp.on_hover_cursor(egui::CursorIcon::PointingHand).clicked() {
                                    self.tab = t;
                                }
                            }
                        });
                    });
                });
            });
        });
        let r = ui.min_rect();
        ui.painter().line_segment([pos2(r.left(), ui.cursor().top()), pos2(ui.max_rect().right(), ui.cursor().top())], Stroke::new(1.0, LINE));
        ui.add_space(20.0);
    }

    /// Scrollable content with a footer pinned to the bottom.
    fn with_footer(&mut self, ui: &mut Ui, id: &str, content: impl FnOnce(&mut Self, &mut Ui), footer: impl FnOnce(&mut Self, &mut Ui)) {
        let footer_h = 66.0;
        let h = (ui.available_height() - footer_h).max(80.0);
        ui.allocate_ui_with_layout(vec2(ui.available_width(), h), Layout::top_down(Align::Min), |ui| {
            egui::ScrollArea::vertical().id_salt(id).auto_shrink([false, false]).show(ui, |ui| content(self, ui));
        });
        ui.allocate_ui_with_layout(vec2(ui.available_width(), footer_h), Layout::left_to_right(Align::Center), |ui| footer(self, ui));
    }

    fn no_key_banner(&mut self, ui: &mut Ui) {
        Frame::new().fill(Color32::from_rgba_unmultiplied(109, 93, 252, 34)).stroke(Stroke::new(1.0, Color32::from_rgba_unmultiplied(109, 93, 252, 90))).corner_radius(12).inner_margin(Margin::symmetric(16, 12)).show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                ui::draw_icon(ui.painter(), Icon::Key, Rect::from_center_size(ui.cursor().min + vec2(9.0, 18.0), Vec2::splat(16.0)), ACCENT_TXT);
                ui.add_space(26.0);
                ui.vertical(|ui| {
                    ui.label(RichText::new("Connect your Roblox account").font(ui::semi(13.5)));
                    ui.label(RichText::new("Sign in with Roblox so Roicon can upload and switch your icons.").size(12.5).color(MUTED));
                });
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if ui::button(ui, Btn::Primary, None, "Connect", true).clicked() {
                        self.modal = Some(self.account_modal());
                    }
                });
            });
        });
        ui.add_space(20.0);
    }

    fn plan_view(&mut self, ui: &mut Ui, ctx: &Context, _data: &Data, e: &Experience, now: i64) {
        let has_key = self.store.has_credential();
        let ready_issue: Option<&str> = if !has_key {
            Some("Connect your Roblox account to continue.")
        } else if e.current_icon.is_none() {
            Some("Choose the current icon.")
        } else if e.new_icon.is_none() {
            Some("Choose the new icon.")
        } else if e.planned_at.is_none() {
            Some("Pick the update date.")
        } else if e.planned_at.unwrap() <= now {
            Some("The update date is in the past.")
        } else if e.enabled_places().is_empty() {
            Some("Turn on at least one place in Settings.")
        } else {
            None
        };
        let e2 = e.clone();
        self.with_footer(
            ui,
            "plan",
            |me, ui| {
                if !has_key {
                    me.no_key_banner(ui);
                }
                ui::section_label(ui, "Icons");
                let w = ui.available_width();
                let cw = (w - 44.0) / 2.0;
                ui.horizontal_top(|ui| {
                    me.icon_card(ui, ctx, &e2, Drop::Current, cw);
                    let (r, _) = ui.allocate_exact_size(vec2(28.0, 136.0), Sense::hover());
                    ui::draw_icon(ui.painter(), Icon::Arrow, Rect::from_center_size(r.center(), Vec2::splat(16.0)), DIM);
                    me.icon_card(ui, ctx, &e2, Drop::New, cw);
                });
                ui.add_space(22.0);
                ui::section_label(ui, "Update date");
                ui::card().inner_margin(Margin::symmetric(16, 12)).show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.horizontal(|ui| {
                        let (r, _) = ui.allocate_exact_size(vec2(22.0, 38.0), Sense::hover());
                        ui::draw_icon(ui.painter(), Icon::Calendar, Rect::from_center_size(r.center(), Vec2::splat(18.0)), MUTED);
                        ui.add_space(6.0);
                        ui.vertical(|ui| match e2.planned_at {
                            Some(t) => {
                                ui.label(RichText::new(fmt_when(t)).font(ui::semi(13.8)));
                                let rel = if t > now { format!("in {}", fmt_left(t - now)) } else { "in the past, pick a new time".into() };
                                ui.label(RichText::new(rel).size(12.0).color(if t > now { DIM } else { RED }));
                            }
                            None => {
                                ui.add_space(9.0);
                                ui.label(RichText::new("No date chosen").size(13.5).color(DIM));
                            }
                        });
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            let label = if e2.planned_at.is_some() { "Change" } else { "Choose" };
                            if ui::button(ui, Btn::Text, None, label, true).clicked() {
                                let t = e2.planned_at.unwrap_or_else(|| {
                                    let n = Local::now() + CDur::hours(12);
                                    n.with_minute(0).unwrap().with_second(0).unwrap().timestamp_millis() + 3_600_000
                                });
                                let d = local(t);
                                me.modal = Some(Modal::Date { exp: e2.id.clone(), date: d.format("%Y-%m-%d").to_string(), time: d.format("%H:%M").to_string(), err: String::new() });
                            }
                        });
                    });
                });
                if e2.planned_at.is_some() || e2.new_icon.is_some() {
                    ui.add_space(22.0);
                    ui::section_label(ui, "Timeline");
                    ui.horizontal_wrapped(|ui| {
                        ui.spacing_mut().item_spacing = vec2(10.0, 10.0);
                        let mut ts = e2.timers.clone();
                        ts.sort_by(|a, b| b.hours.partial_cmp(&a.hours).unwrap_or(std::cmp::Ordering::Equal));
                        for t in &ts {
                            let tex = me.comp_tex(ctx, e2.current_icon.as_ref(), t);
                            let at = e2.planned_at.map(|p| p - (t.hours * 3_600_000.0) as i64);
                            let past = at.map(|a| a <= now).unwrap_or(false);
                            tile(ui, Some(&tex), &t.tag(), &at.map(fmt_short).unwrap_or_else(|| "–".into()), false, past);
                        }
                        let nt = e2.new_icon.as_ref().and_then(|n| me.tex(ctx, n));
                        tile(ui, nt.as_ref(), "Update", &e2.planned_at.map(fmt_short).unwrap_or_else(|| "–".into()), true, false);
                    });
                    if let Some(p) = e2.planned_at {
                        let skipped = e2.timers.iter().filter(|t| p - (t.hours * 3_600_000.0) as i64 <= now).count();
                        if skipped > 0 && p > now {
                            ui.add_space(6.0);
                            ui.label(RichText::new(format!("{skipped} timer(s) are already in the past. The most recent one goes up right away, the rest are skipped.")).size(12.0).color(DIM));
                        }
                    }
                }
                ui.add_space(10.0);
            },
            |me, ui| {
                match ready_issue {
                    Some(m) => ui.label(RichText::new(m).size(12.8).color(DIM)),
                    None => ui.label(RichText::new("Ready to go.").size(12.8).color(GREEN)),
                };
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    let starting = me.busy.contains("start");
                    let r = ui::button_sized(ui, Btn::Primary, Some(Icon::Rocket), if starting { "Starting…" } else { "Start update" }, ready_issue.is_none() && !starting, 40.0);
                    me.start_btn = Some(r.rect);
                    if r.clicked() {
                        me.start_update(&e2);
                    }
                });
            },
        );
    }

    fn icon_card(&mut self, ui: &mut Ui, ctx: &Context, e: &Experience, which: Drop, w: f32) {
        let hovering = ctx.input(|i| !i.raw.hovered_files.is_empty());
        let resp = ui::card().show(ui, |ui| {
            ui.set_width(w - 32.0);
            ui.horizontal_top(|ui| {
                let name = if which == Drop::Current { e.current_icon.clone() } else { e.new_icon.clone() };
                match name.and_then(|n| self.tex(ctx, &n)) {
                    Some(t) => {
                        ui::img(ui, &t, 104.0, 14);
                    }
                    None => {
                        let (r, _) = ui.allocate_exact_size(Vec2::splat(104.0), Sense::hover());
                        dashed_rect(ui.painter(), r, LINE2);
                        ui::draw_icon(ui.painter(), Icon::Image, Rect::from_center_size(r.center(), Vec2::splat(24.0)), DIM);
                    }
                }
                ui.add_space(10.0);
                ui.vertical(|ui| {
                    ui.add_space(14.0);
                    let (title, hint) = if which == Drop::Current { ("Current icon", "Base for the timers") } else { ("New icon", "Set at update time") };
                    ui.label(RichText::new(title).font(ui::semi(14.5)));
                    ui.label(RichText::new(hint).size(12.0).color(DIM));
                    ui.add_space(6.0);
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 4.0;
                        if ui::button(ui, Btn::Ghost, None, "Choose", true).clicked() {
                            if let Some(b) = pick_image() {
                                self.set_image(ctx, &e.id, which.clone(), b);
                            }
                        }
                        if which == Drop::Current {
                            let busy = self.busy.contains("icon-from-roblox");
                            if ui::button(ui, Btn::Text, Some(Icon::Cloud), if busy { "Loading…" } else { "From Roblox" }, !busy).clicked() {
                                let (eid, uni) = (e.id.clone(), e.universe_id.clone());
                                self.bg("icon-from-roblox", move |store| {
                                    let png = roblox::get_game_icon_png(&uni).map_err(|e| e.msg)?;
                                    let png = images::square_icon(&png)?;
                                    let n = store.put_image(&png);
                                    store.update(|d| if let Some(e) = d.exp_mut(&eid) { e.current_icon = Some(n) });
                                    Ok("Loaded the current icon from Roblox.".into())
                                });
                            }
                        } else if e.new_icon.is_some() && ui::button(ui, Btn::Text, None, "Remove", true).clicked() {
                            let eid = e.id.clone();
                            self.store.update(|d| if let Some(e) = d.exp_mut(&eid) { e.new_icon = None });
                        }
                    });
                });
            });
        });
        let rect = resp.response.rect;
        self.drop_rects.push((which, rect));
        if hovering {
            let over = ctx.input(|i| i.pointer.latest_pos()).map(|p| rect.contains(p)).unwrap_or(false);
            ui.painter().rect(rect, 14, Color32::from_rgba_unmultiplied(109, 93, 252, if over { 40 } else { 14 }), Stroke::new(if over { 2.0 } else { 1.0 }, ACCENT), StrokeKind::Inside);
        }
    }

    fn launch_view(&mut self, ui: &mut Ui, ctx: &Context, e: &Experience, now: i64) {
        let u = e.update.clone().unwrap();
        let e2 = e.clone();
        self.with_footer(
            ui,
            "launch",
            |me, ui| {
                // hero
                let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 118.0), Sense::hover());
                let p = ui.painter().clone();
                let (bg1, bg2, k_col, border) = match u.status {
                    Status::Done => (Color32::from_rgb(18, 58, 44), Color32::from_rgb(18, 28, 27), GREEN, Color32::from_rgba_unmultiplied(61, 220, 151, 64)),
                    Status::Cancelled => (Color32::from_rgb(40, 30, 36), Color32::from_rgb(22, 20, 26), MUTED, LINE2),
                    _ => (Color32::from_rgb(42, 33, 96), Color32::from_rgb(26, 24, 52), Color32::from_rgb(167, 157, 255), Color32::from_rgba_unmultiplied(124, 108, 255, 72)),
                };
                p.rect_filled(rect, 16, bg2);
                p.with_clip_rect(rect.shrink(1.0)).add(hgrad_rounded(rect, bg1, bg2));
                ui::glow(&p.with_clip_rect(rect), rect.left_top() + vec2(120.0, -10.0), 260.0, Color32::from_rgba_unmultiplied(150, 135, 255, if u.status.active() { 46 } else { 14 }));
                p.rect_stroke(rect, 16, Stroke::new(1.0, border), StrokeKind::Inside);
                let (k, big, meta) = match u.status {
                    Status::Done => ("UPDATE COMPLETE".to_string(), "New icon is live".to_string(), format!("{} · {}", fmt_when(u.finished_at.unwrap_or(u.at)), u.place_names.join(", "))),
                    Status::Cancelled => ("UPDATE CANCELLED".into(), "Cancelled".into(), format!("Was planned for {}", fmt_when(u.at))),
                    Status::Restoring => ("CANCELLING".into(), "Restoring icon…".into(), u.place_names.join(", ")),
                    _ => ("UPDATE IN".into(), fmt_left(u.at - now), format!("{} · {}", fmt_when(u.at), u.place_names.join(", "))),
                };
                let x = rect.left() + 24.0;
                p.text(pos2(x, rect.top() + 26.0), Align2::LEFT_CENTER, &k, ui::bold(11.0), k_col);
                p.text(pos2(x - 1.0, rect.top() + 57.0), Align2::LEFT_CENTER, &big, ui::bold(32.0), TEXT);
                p.text(pos2(x, rect.top() + 90.0), Align2::LEFT_CENTER, &meta, ui::reg(12.8), Color32::from_rgb(168, 163, 201));
                let live = u.live_step().map(|s| (s.image.clone(), if u.status == Status::Done { "Live now" } else { "Live now" })).or(e2.current_icon.clone().map(|n| (n, "Current")));
                if let Some((img, lab)) = live {
                    if let Some(t) = me.tex(ctx, &img) {
                        let ir = Rect::from_min_size(pos2(rect.right() - 24.0 - 76.0, rect.top() + 14.0), Vec2::splat(76.0));
                        egui::Image::new(&t).corner_radius(13).paint_at(ui, ir);
                        p.text(pos2(ir.center().x, ir.bottom() + 12.0), Align2::CENTER_CENTER, lab, ui::reg(11.5), Color32::from_rgb(168, 163, 201));
                    }
                }
                ui.add_space(22.0);
                ui.horizontal(|ui| {
                    ui::section_label(ui, "Steps");
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ui::link(ui, "View on Roblox").clicked() {
                            crate::open_url(&format!("https://www.roblox.com/games/{}", e2.root_place_id));
                        }
                        let (r, _) = ui.allocate_exact_size(vec2(12.0, 12.0), Sense::hover());
                        ui::draw_icon(ui.painter(), Icon::External, r, ACCENT_TXT);
                    });
                });
                ui::card().inner_margin(Margin::symmetric(0, 6)).show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    for s in u.visible() {
                        Frame::NONE.inner_margin(Margin::symmetric(18, 7)).show(ui, |ui| {
                            ui.horizontal(|ui| {
                                match me.tex(ctx, &s.image) {
                                    Some(t) => {
                                        ui::img(ui, &t, 40.0, 9);
                                    }
                                    None => {
                                        ui::placeholder(ui, 40.0, 9);
                                    }
                                }
                                ui.add_space(4.0);
                                ui.allocate_ui_with_layout(vec2(160.0, 40.0), Layout::top_down(Align::Min), |ui| {
                                    ui.spacing_mut().item_spacing.y = 0.0;
                                    ui.add_space(2.0);
                                    ui.label(RichText::new(&s.label).font(ui::bold(13.0)));
                                    ui.label(RichText::new(s.at.map(fmt_short).unwrap_or_default()).size(11.8).color(DIM));
                                });
                                ui.spacing_mut().item_spacing.x = 6.0;
                                step_chips(ui, s, now);
                            });
                            if let Some(err) = &s.error {
                                if !matches!(s.apply, Apply::Done | Apply::Live | Apply::Skipped) {
                                    ui.horizontal(|ui| {
                                        ui.add_space(52.0);
                                        ui.add(egui::Label::new(RichText::new(err).size(11.8).color(RED)).wrap());
                                    });
                                }
                            }
                        });
                    }
                });
                if !u.log.is_empty() {
                    ui.add_space(14.0);
                    egui::CollapsingHeader::new(RichText::new("Activity").size(12.5).color(MUTED)).id_salt(("log", &u.id)).show(ui, |ui| {
                        for l in u.log.iter().take(12) {
                            ui.label(RichText::new(format!("{}  {}", local(l.t).format("%H:%M:%S"), l.msg)).size(12.0).color(DIM));
                        }
                    });
                }
                ui.add_space(10.0);
            },
            |me, ui| {
                if ui::button(ui, Btn::Text, Some(Icon::Qr), "Send to phone", true).clicked() {
                    match me.relay.start() {
                        Ok(url) => {
                            let png = relay::qr_png(&url);
                            let img = images::decode(&png).unwrap();
                            let qr = ctx.load_texture("qr", egui::ColorImage::from_rgba_unmultiplied([img.width() as usize, img.height() as usize], img.as_raw()), egui::TextureOptions::NEAREST);
                            me.modal = Some(Modal::Phone { url, qr });
                        }
                        Err(err) => me.toast(ctx, err, true),
                    }
                }
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if u.status.active() {
                        if u.status != Status::Restoring && ui::button(ui, Btn::Danger, Some(Icon::Close), "Cancel update", true).clicked() {
                            me.modal = Some(Modal::ConfirmCancel { exp: e2.id.clone() });
                        }
                    } else if ui::button_sized(ui, Btn::Primary, Some(Icon::Plus), "Plan next update", true, 40.0).clicked() {
                        let id = e2.id.clone();
                        me.store.update(|d| if let Some(e) = d.exp_mut(&id) { e.update = None });
                    }
                });
            },
        );
    }

    fn timers_view(&mut self, ui: &mut Ui, ctx: &Context, e: &Experience) {
        let hovering = ctx.input(|i| !i.raw.hovered_files.is_empty());
        egui::ScrollArea::vertical().id_salt("timers").auto_shrink([false, false]).show(ui, |ui| {
            ui.add(egui::Label::new(RichText::new("One transparent 512×512 PNG overlay per timer: it is placed on top of the current icon at the scheduled time. Changes apply to future updates (not to one already started).").size(12.8).color(MUTED)).wrap());
            ui.add_space(14.0);
            ui.horizontal_wrapped(|ui| {
                ui.spacing_mut().item_spacing = vec2(12.0, 12.0);
                let mut ts = e.timers.clone();
                ts.sort_by(|a, b| b.hours.partial_cmp(&a.hours).unwrap_or(std::cmp::Ordering::Equal));
                for t in &ts {
                    let tex = self.comp_tex(ctx, e.current_icon.as_ref(), t);
                    let r = ui::card().inner_margin(Margin::same(12)).show(ui, |ui| {
                        ui.set_width(136.0);
                        ui.vertical(|ui| {
                            ui.horizontal(|ui| {
                                ui.label(RichText::new(t.tag()).font(ui::bold(13.0)));
                                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                    ui.spacing_mut().item_spacing.x = 0.0;
                                    if ui::icon_button(ui, Icon::Trash, 24.0, "Delete timer").clicked() {
                                        let (eid, tid) = (e.id.clone(), t.id.clone());
                                        self.store.update(|d| if let Some(e) = d.exp_mut(&eid) { e.timers.retain(|x| x.id != tid) });
                                    }
                                    if ui::icon_button(ui, Icon::Pencil, 24.0, "Edit timer").clicked() {
                                        self.modal = Some(Modal::Timer { exp: e.id.clone(), id: Some(t.id.clone()), hours: fmt_hours(t.hours), label: t.label.clone(), overlay: t.overlay.clone(), err: String::new() });
                                    }
                                });
                            });
                            ui::img(ui, &tex, 136.0, 11);
                            ui.vertical_centered(|ui| {
                                if ui::button_sized(ui, Btn::Text, None, "Change image", true, 26.0).clicked() {
                                    if let Some(b) = pick_image() {
                                        self.set_image(ctx, &e.id, Drop::Overlay(t.id.clone()), b);
                                    }
                                }
                            });
                        });
                    });
                    let rect = r.response.rect;
                    self.drop_rects.push((Drop::Overlay(t.id.clone()), rect));
                    if hovering && ctx.input(|i| i.pointer.latest_pos()).map(|p| rect.contains(p)).unwrap_or(false) {
                        ui.painter().rect(rect, 14, Color32::from_rgba_unmultiplied(109, 93, 252, 40), Stroke::new(2.0, ACCENT), StrokeKind::Inside);
                    }
                }
                // add timer
                let (r, resp) = ui.allocate_exact_size(vec2(160.0, 214.0), Sense::click());
                let hov = resp.hovered();
                dashed_rect(ui.painter(), r, if hov { Color32::from_rgb(70, 71, 90) } else { LINE2 });
                let c = if hov { TEXT } else { DIM };
                ui::draw_icon(ui.painter(), Icon::Plus, Rect::from_center_size(r.center() - vec2(0.0, 12.0), Vec2::splat(20.0)), c);
                ui.painter().text(r.center() + vec2(0.0, 14.0), Align2::CENTER_CENTER, "Add timer", ui::semi(12.8), c);
                if resp.on_hover_cursor(egui::CursorIcon::PointingHand).clicked() {
                    self.modal = Some(Modal::Timer { exp: e.id.clone(), id: None, hours: "24".into(), label: "24 Hours".into(), overlay: None, err: String::new() });
                }
            });
        });
    }

    fn settings_view(&mut self, ui: &mut Ui, ctx: &Context, e: &Experience) {
        let _ = ctx;
        egui::ScrollArea::vertical().id_salt("settings").auto_shrink([false, false]).show(ui, |ui| {
            ui.horizontal(|ui| {
                ui::section_label(ui, "Places to update");
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    let busy = self.busy.contains("refresh");
                    if ui::button_sized(ui, Btn::Text, Some(Icon::Refresh), if busy { "Refreshing…" } else { "Refresh from Roblox" }, !busy, 28.0).clicked() {
                        let eid = e.id.clone();
                        let uni = e.universe_id.clone();
                        self.bg("refresh", move |store| {
                            let g = roblox::get_game(&uni).map_err(|e| e.msg)?;
                            let places = roblox::get_places(&uni, &g.root_place_id);
                            let rating = roblox::get_rating(&uni);
                            store.update(|d| {
                                if let Some(e) = d.exp_mut(&eid) {
                                    let prev: HashMap<String, bool> = e.places.iter().map(|p| (p.id.clone(), p.enabled)).collect();
                                    e.places = places.iter().map(|(id, name)| Place { id: id.clone(), name: name.clone(), enabled: *prev.get(id).unwrap_or(&true) }).collect();
                                    e.name = g.name.clone();
                                    e.root_place_id = g.root_place_id.clone();
                                    e.creator = Creator { kind: g.creator_kind.clone(), id: g.creator_id.clone(), name: g.creator_name.clone() };
                                    e.rating = rating;
                                    e.playing = g.playing;
                                }
                            });
                            Ok(format!("Found {} place(s).", places.len()))
                        });
                    }
                });
            });
            ui::card().inner_margin(Margin::symmetric(0, 4)).show(ui, |ui| {
                ui.set_width(ui.available_width());
                for p in &e.places {
                    Frame::NONE.inner_margin(Margin::symmetric(16, 9)).show(ui, |ui| {
                        ui.horizontal(|ui| {
                            if ui::checkbox(ui, p.enabled).clicked() {
                                let (eid, pid) = (e.id.clone(), p.id.clone());
                                self.store.update(|d| {
                                    if let Some(pl) = d.exp_mut(&eid).and_then(|e| e.places.iter_mut().find(|x| x.id == pid)) {
                                        pl.enabled = !pl.enabled;
                                    }
                                });
                            }
                            ui.add_space(4.0);
                            ui.vertical(|ui| {
                                ui.spacing_mut().item_spacing.y = 0.0;
                                ui.horizontal(|ui| {
                                    ui.label(RichText::new(&p.name).font(ui::semi(13.0)));
                                    if p.id == e.root_place_id {
                                        ui::chip(ui, ChipKind::Purple, false, false, "Start place");
                                    }
                                });
                                ui.label(RichText::new(format!("Place {}", p.id)).size(11.8).color(DIM));
                            });
                        });
                    });
                }
            });
            ui.label(RichText::new("Each place you tick gets the countdown icons. The start place's icon is the one shown on the experience page.").size(12.0).color(DIM));
            ui.add_space(22.0);
            ui::section_label(ui, "Roblox access");
            ui::card().show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.horizontal(|ui| {
                    ui.vertical(|ui| {
                        ui.label(RichText::new("Check the API key on this experience").font(ui::semi(13.0)));
                        ui.label(RichText::new(format!("Owner: {} ({}) · Universe {}", e.creator.name, e.creator.kind, e.universe_id)).size(12.0).color(DIM));
                    });
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        let busy = self.busy.contains("testkey");
                        if ui::button(ui, Btn::Ghost, None, if busy { "Checking…" } else { "Check access" }, !busy).clicked() {
                            let uni = e.universe_id.clone();
                            self.bg("testkey", move |store| {
                                let cred = store.credential()?;
                                roblox::check_universe_access(&cred, &uni).map_err(|e| e.msg)?;
                                Ok("Your Roblox connection can reach this experience.".into())
                            });
                        }
                    });
                });
            });
            ui.add_space(22.0);
            ui::section_label(ui, "Danger zone");
            ui::card().show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.horizontal(|ui| {
                    ui.vertical(|ui| {
                        ui.label(RichText::new("Remove from Roicon").font(ui::semi(13.0)));
                        ui.label(RichText::new("Nothing changes on Roblox.").size(12.0).color(DIM));
                    });
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ui::button(ui, Btn::Danger, Some(Icon::Trash), "Remove", true).clicked() {
                            self.modal = Some(Modal::ConfirmRemove { exp: e.id.clone() });
                        }
                    });
                });
            });
            ui.add_space(20.0);
        });
    }

    fn welcome(&mut self, ui: &mut Ui, _data: &Data) {
        let has_key = self.store.has_credential();
        ui.vertical_centered(|ui| {
            ui.add_space((ui.available_height() / 2.0 - 230.0).max(20.0));
            let (r, _) = ui.allocate_exact_size(Vec2::splat(64.0), Sense::hover());
            ui::logo(ui.painter(), r);
            ui.add_space(14.0);
            ui.horizontal(|ui| {
                let g1 = ui.painter().layout_no_wrap("Ro".into(), ui::bold(34.0), TEXT);
                let g2 = ui.painter().layout_no_wrap("icon".into(), ui::bold(34.0), ACCENT_TXT);
                let total = g1.size().x + g2.size().x;
                ui.add_space((ui.available_width() - total) / 2.0);
                ui.spacing_mut().item_spacing.x = 0.0;
                ui.label(RichText::new("Ro").font(ui::bold(34.0)));
                ui.label(RichText::new("icon").font(ui::bold(34.0)).color(Color32::from_rgb(132, 140, 255)));
            });
            ui.label(RichText::new("Countdown icons for Roblox. On autopilot.").size(14.5).color(MUTED));
            ui.add_space(26.0);
            ui.horizontal(|ui| {
                let total = 3.0 * 210.0 + 2.0 * 12.0;
                ui.add_space((ui.available_width() - total) / 2.0);
                ui.spacing_mut().item_spacing.x = 12.0;
                for (i, (t, s, done)) in [("Connect Roblox", "Sign in and pick your account.", has_key), ("Add an experience", "Universe ID, place ID or game link.", false), ("Plan the update", "Pick icons and a time. Launch.", false)].iter().enumerate() {
                    ui::card().inner_margin(Margin::same(14)).show(ui, |ui| {
                        ui.set_width(182.0);
                        ui.vertical(|ui| {
                            let (r, _) = ui.allocate_exact_size(vec2(22.0, 22.0), Sense::hover());
                            ui.painter().rect_filled(r, 7, if *done { Color32::from_rgba_unmultiplied(61, 220, 151, 30) } else { Color32::from_rgba_unmultiplied(109, 93, 252, 40) });
                            ui.painter().text(r.center(), Align2::CENTER_CENTER, if *done { "✓".to_string() } else { (i + 1).to_string() }, ui::bold(11.5), if *done { GREEN } else { ACCENT_TXT });
                            ui.label(RichText::new(*t).font(ui::semi(13.0)));
                            ui.label(RichText::new(*s).size(12.0).color(DIM));
                        });
                    });
                }
            });
            ui.add_space(26.0);
            ui.horizontal(|ui| {
                let w = if has_key { 170.0 } else { 300.0 };
                ui.add_space((ui.available_width() - w) / 2.0);
                if !has_key && ui::button_sized(ui, Btn::Ghost, Some(Icon::Key), "Connect Roblox", true, 40.0).clicked() {
                    self.modal = Some(self.account_modal());
                }
                if ui::button_sized(ui, Btn::Primary, Some(Icon::Plus), "Add experience", true, 40.0).clicked() {
                    self.modal = Some(Modal::AddExp { input: String::new(), busy: false, err: String::new() });
                }
            });
        });
    }

    // ---------------- account / Sign in with Roblox ----------------

    fn account_modal(&self) -> Modal {
        let cid = crate::oauth::client_id(&self.store).unwrap_or_default();
        Modal::Account { key: String::new(), busy: false, err: String::new(), show_setup: cid.is_empty() || (self.store.oauth_secret().is_none() && !self.store.uses_oauth()), cid, secret: String::new(), show_key: false }
    }

    fn start_signin(&mut self) {
        if self.signin.is_some() {
            return;
        }
        let cancel = Arc::new(AtomicBool::new(false));
        self.signin = Some(cancel.clone());
        let (tx, store) = (self.tx.clone(), self.store.clone());
        std::thread::spawn(move || {
            let r = crate::oauth::sign_in(&store, cancel);
            let _ = tx.send(Msg::SignInDone(r));
            store.update(|_| ());
        });
    }

    #[allow(clippy::too_many_arguments)]
    fn account_ui(&mut self, ui: &mut Ui, ctx: &Context, data: &Data, key: &mut String, busy: &mut bool, err: &mut String, cid: &mut String, secret: &mut String, show_setup: &mut bool, show_key: &mut bool) -> bool {
        let mut close = false;
        let oauth_on = self.store.uses_oauth();
        let acct = data.account.clone().filter(|a| oauth_on || a.method != "oauth");
        let has_cid = crate::oauth::client_id(&self.store).is_some();
        let signing = self.signin.is_some();
        let w = ui.available_width();

        // ---- header: app ── lock ── account ----
        let (r, _) = ui.allocate_exact_size(vec2(w, 170.0), Sense::hover());
        let p = ui.painter().clone();
        let cy = r.top() + 62.0;
        let (lx, rx) = (r.center().x - 120.0, r.center().x + 120.0);
        let line = if oauth_on { GREEN } else { Color32::from_gray(150) };
        p.line_segment([pos2(lx + 54.0, cy), pos2(rx - 54.0, cy)], Stroke::new(3.5, line));
        draw_lock(&p, pos2(r.center().x, cy), line, oauth_on);
        p.circle_filled(pos2(lx, cy), 50.0, Color32::from_rgb(26, 23, 52));
        p.circle_stroke(pos2(lx, cy), 50.0, Stroke::new(1.0, LINE2));
        ui::logo(&p, Rect::from_center_size(pos2(lx, cy), Vec2::splat(56.0)));
        p.circle_filled(pos2(rx, cy), 50.0, PANEL3);
        let av = acct.as_ref().and_then(|a| a.avatar.clone()).and_then(|n| self.tex(ctx, &n));
        match av.filter(|_| oauth_on) {
            Some(t) => {
                egui::Image::new(&t).corner_radius(50).paint_at(ui, Rect::from_center_size(pos2(rx, cy), Vec2::splat(100.0)));
            }
            None => {
                p.text(pos2(rx, cy), Align2::CENTER_CENTER, "?", ui::bold(34.0), DIM);
            }
        }
        p.text(pos2(lx, cy + 70.0), Align2::CENTER_CENTER, "Roicon", ui::semi(15.0), TEXT);
        p.text(pos2(lx, cy + 90.0), Align2::CENTER_CENTER, "Countdown icons", ui::reg(12.5), ACCENT_TXT);
        let who = acct.as_ref().filter(|_| oauth_on).and_then(|a| a.name.clone()).unwrap_or_else(|| "Your Roblox account".into());
        p.text(pos2(rx, cy + 70.0), Align2::CENTER_CENTER, &who, ui::semi(15.0), TEXT);
        p.text(pos2(rx, cy + 90.0), Align2::CENTER_CENTER, if oauth_on { "Connected" } else { "Not connected" }, ui::reg(12.5), if oauth_on { GREEN } else { DIM });

        // ---- permissions + accounts card ----
        Frame::new().fill(Color32::from_rgb(28, 29, 36)).corner_radius(14).inner_margin(Margin::symmetric(22, 18)).show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                let (c, _) = ui.allocate_exact_size(vec2(22.0, 22.0), Sense::hover());
                ui.painter().circle_filled(c.center(), 11.0, Color32::WHITE);
                ui.painter().text(c.center(), Align2::CENTER_CENTER, "1", ui::bold(12.5), Color32::from_rgb(28, 29, 36));
                ui.label(RichText::new("Your Roblox account").font(ui::bold(18.0)));
            });
            ui.add_space(10.0);
            let row = |ui: &mut Ui, a: &str, b: &str, c: Option<(Color32, &str)>, header: bool| {
                let font = if header { ui::semi(12.8) } else { ui::reg(12.8) };
                let (r, _) = ui.allocate_exact_size(vec2(ui.available_width(), 40.0), Sense::hover());
                let p = ui.painter();
                let y = r.center().y;
                let x0 = r.left() + 14.0;
                let x1 = x0 + 150.0;
                let x2 = r.left() + r.width() * 0.68;
                p.text(pos2(x0, y), Align2::LEFT_CENTER, a, font.clone(), TEXT);
                p.text(pos2(x1, y), Align2::LEFT_CENTER, b, font.clone(), TEXT);
                match c {
                    Some((col, t)) => {
                        p.circle_filled(pos2(x2 + 6.0, y), 6.5, col);
                        p.text(pos2(x2 + 20.0, y), Align2::LEFT_CENTER, t, font, TEXT);
                    }
                    None => {
                        p.text(pos2(x2, y), Align2::LEFT_CENTER, "Risk level", font, TEXT);
                    }
                }
                p.line_segment([pos2(r.left(), r.bottom()), pos2(r.right(), r.bottom())], Stroke::new(1.0, LINE2));
            };
            row(ui, "Permission", "Description", None, true);
            row(ui, "Read profile", "See your username and avatar", Some((GREEN, "Low")), false);
            row(ui, "Read assets", "Check that your icons passed moderation", Some((GREEN, "Low")), false);
            row(ui, "Write assets", "Upload icons and set them on your places", Some((AMBER, "Medium")), false);
            ui.add_space(12.0);
            ui.horizontal(|ui| {
                let (g, _) = ui.allocate_exact_size(vec2(18.0, 18.0), Sense::hover());
                ui.painter().circle_stroke(g.center(), 7.5, Stroke::new(1.6, TEXT));
                ui.painter().line_segment([g.center() - vec2(7.5, 0.0), g.center() + vec2(7.5, 0.0)], Stroke::new(1.2, TEXT));
                ui.painter().line_segment([g.center() - vec2(0.0, 7.5), g.center() + vec2(0.0, 7.5)], Stroke::new(1.2, TEXT));
                ui.label(RichText::new("Accounts").font(ui::semi(14.5)));
            });
            let granted = acct.as_ref().filter(|_| oauth_on).map(|a| a.granted.clone()).unwrap_or_default();
            if granted.is_empty() {
                ui.label(RichText::new("When you press Connect, Roblox opens in your browser. Pick the account (and any groups) that own your games, then press Select.").size(12.8).color(MUTED));
            } else {
                ui.label(RichText::new("Roicon can update games owned by:").size(12.8).color(MUTED));
                ui.add_space(4.0);
                for g in &granted {
                    ui.horizontal(|ui| {
                        ui.add_space(14.0);
                        match g.avatar.as_ref().and_then(|n| self.tex(ctx, n)) {
                            Some(t) => {
                                ui.add(egui::Image::new(&t).fit_to_exact_size(Vec2::splat(34.0)).corner_radius(17));
                            }
                            None => {
                                let (c, _) = ui.allocate_exact_size(Vec2::splat(34.0), Sense::hover());
                                ui.painter().circle_filled(c.center(), 17.0, PANEL3);
                            }
                        }
                        ui.label(RichText::new(&g.name).size(13.5));
                        if g.kind == "Group" {
                            ui::chip(ui, ChipKind::Purple, false, false, "Group");
                        }
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            ui::chip(ui, ChipKind::Green, true, false, "Selected");
                        });
                    });
                }
            }
            ui.add_space(14.0);
            ui.horizontal(|ui| {
                if signing {
                    ui::chip(ui, ChipKind::Purple, false, true, "Waiting for you in the browser…");
                    if ui::button(ui, Btn::Text, None, "Cancel", true).clicked() {
                        if let Some(c) = &self.signin {
                            c.store(true, Ordering::Relaxed);
                        }
                    }
                } else if oauth_on {
                    if ui::button(ui, Btn::Ghost, Some(Icon::Refresh), "Change accounts", has_cid).clicked() {
                        err.clear();
                        self.start_signin();
                    }
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ui::button(ui, Btn::Danger, None, "Disconnect", true).clicked() {
                            let store = self.store.clone();
                            std::thread::spawn(move || crate::oauth::sign_out(&store));
                        }
                    });
                } else {
                    let r = ui::button_sized(ui, Btn::Primary, None, "Connect with Roblox", has_cid, 40.0);
                    if r.clicked() {
                        err.clear();
                        self.start_signin();
                    }
                    if !has_cid {
                        ui.label(RichText::new("Finish the one-time setup below first.").size(12.5).color(DIM));
                    }
                }
            });
            err_line(ui, err);
        });

        // ---- one-time setup ----
        ui.add_space(12.0);
        let setup_hdr = egui::CollapsingHeader::new(RichText::new(if has_cid { "Sign in with Roblox setup" } else { "One-time setup (about 2 minutes)" }).font(ui::semi(13.0)))
            .id_salt("oauth-setup")
            .open(if *show_setup { Some(true) } else { None })
            .show(ui, |ui| {
                ui.add(egui::Label::new(RichText::new("Roblox only shows its sign-in page for registered apps, so register Roicon once under your own Roblox account (you need to be ID-verified). Private apps work for up to 10 accounts.").size(12.5).color(MUTED)).wrap());
                ui.add_space(6.0);
                let step = |ui: &mut Ui, n: &str, body: &mut dyn FnMut(&mut Ui)| {
                    ui.horizontal_top(|ui| {
                        let (c, _) = ui.allocate_exact_size(vec2(20.0, 20.0), Sense::hover());
                        ui.painter().rect_filled(c, 6, Color32::from_rgba_unmultiplied(109, 93, 252, 40));
                        ui.painter().text(c.center(), Align2::CENTER_CENTER, n, ui::bold(11.0), ACCENT_TXT);
                        ui.vertical(|ui| body(ui));
                    });
                    ui.add_space(6.0);
                };
                step(ui, "1", &mut |ui| {
                    ui.horizontal(|ui| {
                        ui.label(RichText::new("In Creator Hub, open OAuth 2.0 Apps and create an app.").size(12.8));
                        if ui::link(ui, "Open Creator Hub").clicked() {
                            crate::open_url("https://create.roblox.com/dashboard/credentials?activeTab=OAuthTab");
                        }
                    });
                });
                step(ui, "2", &mut |ui| {
                    ui.label(RichText::new("Add this Redirect URL:").size(12.8));
                    ui.horizontal(|ui| {
                        let mut ru = crate::oauth::redirect_uri();
                        ui.add(egui::TextEdit::singleline(&mut ru).font(egui::TextStyle::Monospace).desired_width(300.0).margin(Margin::symmetric(8, 6)));
                        if ui::button_sized(ui, Btn::Ghost, None, "Copy", true, 28.0).clicked() {
                            ctx.copy_text(crate::oauth::redirect_uri());
                        }
                    });
                });
                step(ui, "3", &mut |ui| {
                    ui.label(RichText::new("Under Permissions, add: openid, profile, asset:read, asset:write.").size(12.8));
                });
                step(ui, "4", &mut |ui| {
                    ui.label(RichText::new("Paste the Client ID and Client Secret it gives you:").size(12.8));
                    ui.add(egui::TextEdit::singleline(cid).hint_text("Client ID").desired_width(360.0).margin(Margin::symmetric(8, 7)));
                    ui.add(egui::TextEdit::singleline(secret).password(true).hint_text(if self.store.oauth_secret().is_some() { "Client Secret (saved, paste to replace)" } else { "Client Secret" }).desired_width(360.0).margin(Margin::symmetric(8, 7)));
                    ui.label(RichText::new("The secret is kept in Windows Credential Manager on this PC only.").size(11.8).color(DIM));
                });
                ui.horizontal(|ui| {
                    ui.add_space(28.0);
                    if ui::button(ui, Btn::Primary, None, "Save", !cid.trim().is_empty()).clicked() {
                        let c = cid.trim().to_owned();
                        self.store.update(|d| d.oauth_client_id = Some(c));
                        if !secret.trim().is_empty() {
                            self.store.set_oauth_secret(Some(secret));
                            secret.clear();
                        }
                        *show_setup = false;
                        self.toast(ctx, "Saved. Now press Connect with Roblox.", false);
                    }
                });
            });
        if setup_hdr.header_response.clicked() {
            *show_setup = false;
        }

        // ---- API key fallback ----
        egui::CollapsingHeader::new(RichText::new("Advanced: use an Open Cloud API key instead").font(ui::semi(13.0)).color(MUTED)).id_salt("apikey").default_open(*show_key).show(ui, |ui| {
            let has = self.store.api_key().is_some();
            if has {
                ui.horizontal(|ui| {
                    ui::chip(ui, ChipKind::Green, true, false, "API key saved");
                    if oauth_on {
                        ui.label(RichText::new("Sign in with Roblox is used first.").size(12.5).color(DIM));
                    }
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ui::button_sized(ui, Btn::Danger, None, "Remove key", true, 28.0).clicked() {
                            self.store.clear_api_key();
                            if !oauth_on {
                                self.store.update(|d| d.account = None);
                            }
                        }
                    });
                });
            }
            ui.add(egui::TextEdit::singleline(key).password(true).hint_text(if has { "Paste a new key to replace it" } else { "Paste your API key" }).desired_width(f32::INFINITY).margin(Margin::symmetric(10, 9)));
            ui.add(egui::Label::new(RichText::new("Creator Hub → Open Cloud → API Keys. Add the Assets API with Read and Write. Group games need a key owned by the group.").size(12.0).color(DIM)).wrap());
            ui.horizontal(|ui| {
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if ui::button(ui, Btn::Ghost, None, if *busy { "Checking…" } else { "Save key" }, !*busy && !key.trim().is_empty()).clicked() {
                        *busy = true;
                        err.clear();
                        self.save_key(key.clone());
                    }
                });
            });
        });

        // ---- app settings ----
        ui.add_space(10.0);
        ui::section_label(ui, "App");
        let s = data.settings.clone();
        let mut toggle = |ui: &mut Ui, title: &str, sub: &str, on: bool, f: fn(&mut Settings)| {
            ui.horizontal(|ui| {
                ui.vertical(|ui| {
                    ui.spacing_mut().item_spacing.y = 0.0;
                    ui.label(RichText::new(title).font(ui::semi(13.0)));
                    ui.label(RichText::new(sub).size(12.0).color(DIM));
                });
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if ui::switch(ui, on).clicked() {
                        self.store.update(|d| f(&mut d.settings));
                        crate::set_launch_at_login(self.store.lock().settings.launch_at_login);
                    }
                });
            });
            ui.add_space(4.0);
        };
        toggle(ui, "Start with Windows", "Runs quietly in the tray so updates happen on time.", s.launch_at_login, |s| s.launch_at_login = !s.launch_at_login);
        toggle(ui, "Keep running when closed", "Closing the window keeps Roicon in the tray.", s.close_to_tray, |s| s.close_to_tray = !s.close_to_tray);
        toggle(ui, "Notifications", "Tell me when each icon goes live.", s.notifications, |s| s.notifications = !s.notifications);
        ui.horizontal(|ui| {
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if ui::button(ui, Btn::Ghost, None, "Done", !*busy).clicked() {
                    close = true;
                }
            });
        });
        close
    }

    // ---------------- modals ----------------

    fn modals(&mut self, ctx: &Context, data: &Data) {
        let Some(mut m) = self.modal.take() else { return };
        let mut close = false;
        let frame = Frame::new().fill(Color32::from_rgb(21, 22, 29)).stroke(Stroke::new(1.0, LINE2)).corner_radius(16).inner_margin(Margin::same(22));
        let width = match &m { Modal::Phone { .. } | Modal::Timer { .. } => 600.0, Modal::Account { .. } => 640.0, _ => 440.0 };
        let resp = egui::Modal::new(Id::new("modal")).frame(frame).backdrop_color(Color32::from_black_alpha(150)).show(ctx, |ui| {
            ui.set_width(width);
            ui.spacing_mut().item_spacing.y = 8.0;
            match &mut m {
                Modal::AddExp { input, busy, err } => {
                    ui.label(RichText::new("Add experience").font(ui::bold(16.0)));
                    ui.label(RichText::new("Paste the game's roblox.com link or its place ID (the number in the link). A universe ID works too.").size(12.8).color(MUTED));
                    ui.add_space(6.0);
                    let r = ui.add(egui::TextEdit::singleline(input).hint_text("e.g. 6284917305 or https://www.roblox.com/games/…").desired_width(f32::INFINITY).margin(Margin::symmetric(10, 9)));
                    if !*busy && input.is_empty() && !r.has_focus() {
                        r.request_focus();
                    }
                    let enter = ui.input(|i| i.key_pressed(egui::Key::Enter));
                    err_line(ui, err);
                    ui.horizontal(|ui| {
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            let go = ui::button(ui, Btn::Primary, None, if *busy { "Looking it up…" } else { "Add" }, !*busy && !input.trim().is_empty()).clicked() || (enter && !input.trim().is_empty() && !*busy);
                            if ui::button(ui, Btn::Text, None, "Cancel", !*busy).clicked() {
                                close = true;
                            }
                            if go {
                                *busy = true;
                                err.clear();
                                self.add_experience(input.clone());
                            }
                        });
                    });
                }
                Modal::Account { key, busy, err, cid, secret, show_setup, show_key } => {
                    let max_h = ctx.screen_rect().height() - 110.0;
                    egui::ScrollArea::vertical().max_height(max_h).min_scrolled_height(max_h.min(660.0)).auto_shrink([false, true]).show(ui, |ui| {
                        if self.account_ui(ui, ctx, data, key, busy, err, cid, secret, show_setup, show_key) {
                            close = true;
                        }
                    });
                }
                Modal::Date { exp, date, time, err } => {
                    ui.label(RichText::new("Update date").font(ui::bold(16.0)));
                    ui.label(RichText::new("When should the new icon go live? The countdown icons go up before it.").size(12.8).color(MUTED));
                    ui.add_space(4.0);
                    ui.horizontal_wrapped(|ui| {
                        let now = Local::now();
                        let at = |d: chrono::DateTime<Local>| (d.format("%Y-%m-%d").to_string(), d.format("%H:%M").to_string());
                        let next18 = |days: i64| {
                            let d = (now + CDur::days(days)).date_naive().and_time(NaiveTime::from_hms_opt(18, 0, 0).unwrap());
                            Local.from_local_datetime(&d).single().unwrap_or(now)
                        };
                        let in12 = {
                            let t = now + CDur::hours(12);
                            let m = (t.minute() / 15 + 1) * 15;
                            t.with_minute(0).unwrap().with_second(0).unwrap() + CDur::minutes(m as i64)
                        };
                        let sat = (6 - now.weekday().num_days_from_monday() as i64 - 1).rem_euclid(7);
                        let sat = if sat == 0 && now.hour() >= 18 { 7 } else { sat };
                        let picks = [("In 12 hours", at(in12)), ("Tonight 18:00", at(next18(if now.hour() >= 18 { 1 } else { 0 }))), ("Tomorrow 18:00", at(next18(1))), ("Saturday 18:00", at(next18(sat)))];
                        for (lab, (d, t)) in picks {
                            if ui::button_sized(ui, Btn::Ghost, None, lab, true, 28.0).clicked() {
                                *date = d;
                                *time = t;
                            }
                        }
                    });
                    ui.add_space(4.0);
                    ui.horizontal(|ui| {
                        ui.vertical(|ui| {
                            ui.label(RichText::new("Date (YYYY-MM-DD)").font(ui::semi(12.0)).color(MUTED));
                            ui.add(egui::TextEdit::singleline(date).desired_width(220.0).margin(Margin::symmetric(10, 9)));
                        });
                        ui.vertical(|ui| {
                            ui.label(RichText::new("Time (24h, HH:MM)").font(ui::semi(12.0)).color(MUTED));
                            ui.add(egui::TextEdit::singleline(time).desired_width(150.0).margin(Margin::symmetric(10, 9)));
                        });
                    });
                    let parsed = NaiveDate::parse_from_str(date.trim(), "%Y-%m-%d").ok().zip(NaiveTime::parse_from_str(time.trim(), "%H:%M").ok()).and_then(|(d, t)| Local.from_local_datetime(&d.and_time(t)).single());
                    match parsed {
                        Some(p) => ui.label(RichText::new(format!("{} · in {}", fmt_when(p.timestamp_millis()), fmt_left(p.timestamp_millis() - now_ms()))).size(12.5).color(if p.timestamp_millis() > now_ms() { GREEN } else { RED })),
                        None => ui.label(RichText::new("Enter a date like 2026-11-28 and a time like 18:00.").size(12.5).color(DIM)),
                    };
                    err_line(ui, err);
                    ui.horizontal(|ui| {
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            if ui::button(ui, Btn::Primary, None, "Save", parsed.is_some()).clicked() {
                                let t = parsed.unwrap().timestamp_millis();
                                if t <= now_ms() {
                                    *err = "Pick a time in the future.".into();
                                } else {
                                    let id = exp.clone();
                                    self.store.update(|d| if let Some(e) = d.exp_mut(&id) { e.planned_at = Some(t) });
                                    close = true;
                                }
                            }
                            if ui::button(ui, Btn::Text, None, "Cancel", true).clicked() {
                                close = true;
                            }
                        });
                    });
                }
                Modal::Timer { exp, id, hours, label, overlay, err } => {
                    ui.label(RichText::new(if id.is_some() { "Edit timer" } else { "Add timer" }).font(ui::bold(16.0)));
                    ui.label(RichText::new("A timer puts an overlay on the current icon a set number of hours before the update.").size(12.8).color(MUTED));
                    ui.add_space(6.0);
                    let base = data.exp(exp).and_then(|e| e.current_icon.clone());
                    let h: Option<f64> = hours.trim().replace(',', ".").parse().ok().filter(|h: &f64| *h > 0.0 && *h <= 24.0 * 30.0);
                    let preview = Timer { id: "preview".into(), hours: h.unwrap_or(1.0), label: label.clone(), overlay: overlay.clone() };
                    let tex = self.comp_tex(ctx, base.as_ref(), &preview);
                    ui.horizontal_top(|ui| {
                        ui::img(ui, &tex, 160.0, 12);
                        ui.add_space(10.0);
                        ui.vertical(|ui| {
                            ui.label(RichText::new("Hours before the update").font(ui::semi(12.0)).color(MUTED));
                            let old = hours.clone();
                            ui.add(egui::TextEdit::singleline(hours).desired_width(120.0).margin(Margin::symmetric(10, 9)));
                            if *hours != old {
                                if let Ok(v) = hours.trim().parse::<f64>() {
                                    let auto_old = old.trim().parse::<f64>().ok().map(|o| format!("{} Hour{}", fmt_hours(o), if o == 1.0 { "" } else { "s" }));
                                    if overlay.is_none() && (auto_old.as_deref() == Some(label.as_str()) || label.is_empty()) {
                                        *label = format!("{} Hour{}", fmt_hours(v), if v == 1.0 { "" } else { "s" });
                                    }
                                }
                            }
                            ui.add_space(4.0);
                            ui.label(RichText::new("Text on the built-in overlay").font(ui::semi(12.0)).color(MUTED));
                            ui.add_enabled(overlay.is_none(), egui::TextEdit::singleline(label).desired_width(260.0).margin(Margin::symmetric(10, 9)));
                            ui.add_space(4.0);
                            ui.horizontal(|ui| {
                                if ui::button(ui, Btn::Ghost, Some(Icon::Image), "Use my own PNG", true).clicked() {
                                    if let Some(b) = pick_image() {
                                        match images::fit_overlay(&b) {
                                            Ok(png) => *overlay = Some(self.store.put_image(&png)),
                                            Err(e2) => *err = e2,
                                        }
                                    }
                                }
                                if overlay.is_some() && ui::button(ui, Btn::Text, None, "Use built-in", true).clicked() {
                                    *overlay = None;
                                }
                            });
                        });
                    });
                    err_line(ui, err);
                    ui.horizontal(|ui| {
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            if ui::button(ui, Btn::Primary, None, "Save", h.is_some()).clicked() {
                                let h = h.unwrap();
                                let (eid, tid) = (exp.clone(), id.clone());
                                let (lab, ov) = (if label.trim().is_empty() { format!("{} Hours", fmt_hours(h)) } else { label.trim().to_owned() }, overlay.clone());
                                self.store.update(|d| {
                                    if let Some(e) = d.exp_mut(&eid) {
                                        match tid.and_then(|t| e.timers.iter_mut().find(|x| x.id == t)) {
                                            Some(t) => {
                                                t.hours = h;
                                                t.label = lab;
                                                t.overlay = ov;
                                            }
                                            None => e.timers.push(Timer { id: uid(), hours: h, label: lab, overlay: ov }),
                                        }
                                    }
                                });
                                close = true;
                            }
                            if ui::button(ui, Btn::Text, None, "Cancel", true).clicked() {
                                close = true;
                            }
                            if h.is_none() {
                                ui.label(RichText::new("Hours must be a number above 0.").size(12.0).color(DIM));
                            }
                        });
                    });
                }
                Modal::Phone { url, qr } => {
                    ui.label(RichText::new("Send to phone").font(ui::bold(16.0)));
                    ui.add_space(8.0);
                    ui.horizontal_top(|ui| {
                        let (r, _) = ui.allocate_exact_size(Vec2::splat(230.0), Sense::hover());
                        ui.painter().rect_filled(r, 12, Color32::WHITE);
                        egui::Image::new(&*qr).paint_at(ui, r.shrink(10.0));
                        ui.add_space(16.0);
                        ui.vertical(|ui| {
                            ui.set_width(320.0);
                            ui.add_space(8.0);
                            for (i, s) in ["Connect your phone to the same Wi-Fi as this PC.", "Open the camera and point it at this code.", "Your phone shows the countdown live, with each icon as it goes up."].iter().enumerate() {
                                ui.horizontal_top(|ui| {
                                    let (r, _) = ui.allocate_exact_size(vec2(20.0, 20.0), Sense::hover());
                                    ui.painter().rect_filled(r, 6, Color32::from_rgba_unmultiplied(109, 93, 252, 40));
                                    ui.painter().text(r.center(), Align2::CENTER_CENTER, (i + 1).to_string(), ui::bold(11.0), ACCENT_TXT);
                                    ui.add(egui::Label::new(RichText::new(*s).size(12.8).color(MUTED)).wrap());
                                });
                                ui.add_space(4.0);
                            }
                            ui.add(egui::Label::new(RichText::new("This PC does the icon switching, so leave it on (it can stay in the tray). If Windows asks about network access, allow private networks.").size(12.0).color(DIM)).wrap());
                            ui.add_space(4.0);
                            ui.add(egui::Label::new(RichText::new(url.as_str()).size(11.0).color(DIM)).wrap());
                        });
                    });
                    ui.horizontal(|ui| {
                        if ui::button_sized(ui, Btn::Text, Some(Icon::Refresh), "New link", true, 30.0).on_hover_text("Old QR codes stop working").clicked() {
                            if let Some(u2) = self.relay.rotate() {
                                let png = relay::qr_png(&u2);
                                let img = images::decode(&png).unwrap();
                                *qr = ctx.load_texture("qr", egui::ColorImage::from_rgba_unmultiplied([img.width() as usize, img.height() as usize], img.as_raw()), egui::TextureOptions::NEAREST);
                                *url = u2;
                            }
                        }
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            if ui::button(ui, Btn::Primary, None, "Done", true).clicked() {
                                close = true;
                            }
                        });
                    });
                }
                Modal::ConfirmCancel { exp } => {
                    ui.label(RichText::new("Cancel this update?").font(ui::bold(16.0)));
                    ui.add(egui::Label::new(RichText::new("No more icons will change. If a countdown icon is already live, the original icon is put back once Roblox approves it.").size(12.8).color(MUTED)).wrap());
                    ui.horizontal(|ui| {
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            if ui::button(ui, Btn::Danger, Some(Icon::Close), "Cancel update", true).clicked() {
                                self.sched.cancel_update(exp);
                                close = true;
                            }
                            if ui::button(ui, Btn::Text, None, "Keep it", true).clicked() {
                                close = true;
                            }
                        });
                    });
                }
                Modal::ConfirmRemove { exp } => {
                    let name = data.exp(exp).map(|e| e.name.clone()).unwrap_or_default();
                    ui.label(RichText::new(format!("Remove {name}?")).font(ui::bold(16.0)));
                    let running = data.exp(exp).map(|e| e.active_update().is_some()).unwrap_or(false);
                    ui.add(egui::Label::new(RichText::new(if running { "Cancel the running update first." } else { "It is removed from Roicon only. Nothing changes on Roblox." }).size(12.8).color(MUTED)).wrap());
                    ui.horizontal(|ui| {
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            if ui::button(ui, Btn::Danger, Some(Icon::Trash), "Remove", !running).clicked() {
                                let id = exp.clone();
                                self.store.update(|d| {
                                    d.experiences.retain(|e| e.id != id);
                                    if d.selected.as_deref() == Some(id.as_str()) {
                                        d.selected = d.experiences.first().map(|e| e.id.clone());
                                    }
                                });
                                self.tab = Tab::Update;
                                close = true;
                            }
                            if ui::button(ui, Btn::Text, None, "Keep", true).clicked() {
                                close = true;
                            }
                        });
                    });
                }
                Modal::QuitConfirm => {
                    ui.label(RichText::new("An update is scheduled").font(ui::bold(16.0)));
                    ui.add(egui::Label::new(RichText::new("If you quit, icons will not change until you open Roicon again.").size(12.8).color(MUTED)).wrap());
                    ui.horizontal(|ui| {
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            if ui::button(ui, Btn::Danger, None, "Quit anyway", true).clicked() {
                                self.quitting = true;
                                ctx.send_viewport_cmd(ViewportCommand::Close);
                                close = true;
                            }
                            if ui::button(ui, Btn::Primary, None, "Keep running", true).clicked() {
                                close = true;
                            }
                        });
                    });
                }
            }
        });
        let busy = matches!(&m, Modal::AddExp { busy: true, .. } | Modal::Account { busy: true, .. });
        if resp.should_close() && !busy {
            close = true;
        }
        if !close && self.modal.is_none() {
            self.modal = Some(m);
        }
    }

    fn handle_drops(&mut self, ctx: &Context, data: &Data) {
        let dropped = ctx.input(|i| i.raw.dropped_files.clone());
        if dropped.is_empty() {
            return;
        }
        let Some(eid) = data.selected.clone().or_else(|| data.experiences.first().map(|e| e.id.clone())) else { return };
        let pos = ctx.input(|i| i.pointer.latest_pos());
        let target = pos.and_then(|p| self.drop_rects.iter().find(|(_, r)| r.contains(p)).map(|(d, _)| d.clone())).or_else(|| {
            if self.tab == Tab::Update {
                let e = data.exp(&eid)?;
                Some(if e.current_icon.is_none() { Drop::Current } else { Drop::New })
            } else {
                None
            }
        });
        let Some(target) = target else {
            self.toast(ctx, "Drop the image onto an icon card.", true);
            return;
        };
        if let Some(f) = dropped.first() {
            let bytes = f.bytes.as_ref().map(|b| b.to_vec()).or_else(|| f.path.as_ref().and_then(|p| std::fs::read(p).ok()));
            if let Some(b) = bytes {
                self.set_image(ctx, &eid, target, b);
            }
        }
    }

    fn overlays(&mut self, ctx: &Context) {
        // toasts
        let t = ctx.input(|i| i.time);
        self.toasts.retain(|(_, _, at)| t - at < 4.5);
        if !self.toasts.is_empty() {
            egui::Area::new(Id::new("toasts")).anchor(Align2::RIGHT_BOTTOM, vec2(-18.0, -18.0)).order(egui::Order::Foreground).interactable(false).show(ctx, |ui| {
                for (msg, err, _) in &self.toasts {
                    Frame::new().fill(Color32::from_rgb(26, 27, 35)).stroke(Stroke::new(1.0, LINE2)).corner_radius(11).inner_margin(Margin::symmetric(14, 11)).shadow(egui::Shadow { offset: [0, 10], blur: 30, spread: 0, color: Color32::from_black_alpha(120) }).show(ui, |ui| {
                        ui.set_max_width(380.0);
                        ui.horizontal(|ui| {
                            let (r, _) = ui.allocate_exact_size(vec2(8.0, 16.0), Sense::hover());
                            ui.painter().circle_filled(r.center(), 4.0, if *err { RED } else { GREEN });
                            ui.add(egui::Label::new(RichText::new(msg).size(12.8)).wrap());
                        });
                    });
                }
            });
            ctx.request_repaint_after(std::time::Duration::from_millis(250));
        }
        // confetti
        if !self.confetti.is_empty() {
            let dt = ctx.input(|i| i.stable_dt).min(0.05);
            let p = ctx.layer_painter(egui::LayerId::new(egui::Order::Tooltip, Id::new("confetti")));
            let h = ctx.screen_rect().bottom();
            for c in self.confetti.iter_mut() {
                c.v.y += 1100.0 * dt;
                c.v *= 1.0 - 0.9 * dt;
                c.p += c.v * dt;
                c.rot += c.vr * dt;
                c.life -= dt;
                let (s, co) = c.rot.sin_cos();
                let hx = vec2(co, s) * c.size.x;
                let hy = vec2(-s, co) * c.size.y * (c.rot * 1.7).sin().abs().max(0.2);
                let alpha = (c.life / 0.4).clamp(0.0, 1.0);
                p.add(egui::Shape::convex_polygon(vec![c.p - hx - hy, c.p + hx - hy, c.p + hx + hy, c.p - hx + hy], c.col.gamma_multiply(alpha), Stroke::NONE));
            }
            self.confetti.retain(|c| c.life > 0.0 && c.p.y < h + 20.0);
            ctx.request_repaint();
        }
    }
}

fn draw_lock(p: &egui::Painter, c: Pos2, col: Color32, closed: bool) {
    p.circle_filled(c, 22.0, Color32::from_rgb(21, 22, 29));
    let body = Rect::from_center_size(c + vec2(0.0, 5.0), vec2(22.0, 17.0));
    p.rect_filled(body, 4, col);
    let lift = if closed { 0.0 } else { 4.0 };
    let pts: Vec<Pos2> = (0..=16)
        .map(|i| {
            let a = std::f32::consts::PI * (1.0 + i as f32 / 16.0);
            c + vec2(7.0 * a.cos(), -3.0 - lift + 8.0 * a.sin())
        })
        .collect();
    let mut shackle = vec![c + vec2(-7.0, 0.0)];
    shackle.extend(pts);
    shackle.push(c + vec2(7.0, if closed { 0.0 } else { -4.0 }));
    p.line(shackle, Stroke::new(3.0, col));
    p.circle_filled(body.center() - vec2(0.0, 1.0), 2.6, Color32::from_rgb(21, 22, 29));
}

fn err_line(ui: &mut Ui, err: &str) {
    if !err.is_empty() {
        ui.add(egui::Label::new(RichText::new(err).size(12.5).color(RED)).wrap());
    }
}

fn elide(ui: &Ui, s: &str, font: egui::FontId, maxw: f32) -> String {
    let w = |t: &str| ui.painter().layout_no_wrap(t.to_owned(), font.clone(), TEXT).size().x;
    if w(s) <= maxw {
        return s.to_owned();
    }
    let mut chars: Vec<char> = s.chars().collect();
    while !chars.is_empty() && w(&(chars.iter().collect::<String>() + "…")) > maxw {
        chars.pop();
    }
    chars.into_iter().collect::<String>() + "…"
}

fn dashed_rect(p: &egui::Painter, r: Rect, col: Color32) {
    let r = r.shrink(1.0);
    let st = Stroke::new(1.5, col);
    let pts = [r.left_top(), r.right_top(), r.right_bottom(), r.left_bottom(), r.left_top()];
    for w in pts.windows(2) {
        p.extend(egui::Shape::dashed_line(&[w[0], w[1]], st, 6.0, 5.0));
    }
}

fn hgrad_rounded(r: Rect, a: Color32, b: Color32) -> egui::Shape {
    let mut mesh = egui::Mesh::default();
    mesh.colored_vertex(r.left_top(), a);
    mesh.colored_vertex(r.right_top(), b);
    mesh.colored_vertex(r.left_bottom(), a.lerp_to_gamma(b, 0.35));
    mesh.colored_vertex(r.right_bottom(), b);
    mesh.add_triangle(0, 1, 2);
    mesh.add_triangle(1, 2, 3);
    egui::Shape::mesh(mesh)
}

fn tile(ui: &mut Ui, tex: Option<&TextureHandle>, label: &str, time: &str, final_: bool, past: bool) {
    let (rect, _) = ui.allocate_exact_size(vec2(116.0, 150.0), Sense::hover());
    let p = ui.painter();
    let op: f32 = if past { 0.4 } else { 1.0 };
    if final_ {
        p.rect_filled(rect.expand(3.0), 14, Color32::from_rgba_unmultiplied(109, 93, 252, 20));
    }
    p.rect(rect, 12, PANEL.gamma_multiply(op.max(0.6)), Stroke::new(1.0, if final_ { Color32::from_rgba_unmultiplied(124, 108, 255, 150) } else { LINE }), StrokeKind::Inside);
    let ir = Rect::from_min_size(rect.min + vec2(8.0, 8.0), Vec2::splat(100.0));
    match tex {
        Some(t) => {
            egui::Image::new(t).corner_radius(10).tint(Color32::WHITE.gamma_multiply(op)).paint_at(ui, ir);
        }
        None => {
            p.rect_filled(ir, 10, PANEL3);
            ui::draw_icon(p, Icon::Image, Rect::from_center_size(ir.center(), Vec2::splat(22.0)), DIM);
        }
    }
    let lc = if final_ { ACCENT_TXT } else { TEXT };
    p.text(pos2(rect.center().x, ir.bottom() + 15.0), Align2::CENTER_CENTER, label, ui::bold(12.8), lc.gamma_multiply(op));
    p.text(pos2(rect.center().x, ir.bottom() + 31.0), Align2::CENTER_CENTER, time, ui::reg(10.8), DIM.gamma_multiply(op));
}

fn step_chips(ui: &mut Ui, s: &Step, _now: i64) {
    match s.upload {
        Upload::Pending => ui::chip(ui, ChipKind::Grey, false, false, "Queued"),
        Upload::Uploading => ui::chip(ui, ChipKind::Purple, false, true, "Uploading"),
        Upload::Done => ui::chip(ui, ChipKind::Green, true, false, "Uploaded"),
        Upload::Error => ui::chip(ui, ChipKind::Red, false, false, "Upload failed, retrying"),
        Upload::Skipped => ui::chip(ui, ChipKind::Grey, false, false, "Skipped"),
    }
    if s.upload == Upload::Done {
        match s.moderation.as_str() {
            "Approved" => ui::chip(ui, ChipKind::Green, true, false, "Approved"),
            "Rejected" => ui::chip(ui, ChipKind::Red, false, false, "Rejected"),
            _ => ui::chip(ui, ChipKind::Amber, false, false, "In moderation"),
        }
    }
    match s.apply {
        Apply::Upcoming => ui::chip(ui, ChipKind::Grey, false, false, "Upcoming"),
        Apply::Waiting => ui::chip(ui, ChipKind::Amber, false, true, "Waiting for approval"),
        Apply::Retrying => ui::chip(ui, ChipKind::Amber, false, true, "Retrying"),
        Apply::Live => ui::chip(ui, ChipKind::Live, false, false, "● Live"),
        Apply::Done => ui::chip(ui, ChipKind::Green, true, false, if s.key == "new" { "Applied" } else { "Done" }),
        Apply::Skipped if s.upload != Upload::Skipped => ui::chip(ui, ChipKind::Grey, false, false, "Skipped"),
        Apply::Error => ui::chip(ui, ChipKind::Red, false, false, "Failed"),
        _ => {}
    }
}

impl eframe::App for App {
    fn clear_color(&self, _visuals: &egui::Visuals) -> [f32; 4] {
        [11.0 / 255.0, 11.0 / 255.0, 16.0 / 255.0, 1.0]
    }

    fn update(&mut self, ctx: &Context, _frame: &mut eframe::Frame) {
        self.handle_msgs(ctx);
        let data = self.store.lock().clone();
        let now = now_ms();
        self.handle_close(ctx, &data);

        // background
        let bgp = ctx.layer_painter(egui::LayerId::background());
        let sr = ctx.screen_rect();
        bgp.rect_filled(sr, 0, ui::BG);
        ui::glow(&bgp, sr.left_top() + vec2(-40.0, -60.0), 760.0, Color32::from_rgba_unmultiplied(109, 93, 252, 52));
        ui::glow(&bgp, sr.right_bottom() + vec2(60.0, 80.0), 620.0, Color32::from_rgba_unmultiplied(91, 140, 255, 24));

        self.drop_rects.clear();
        self.titlebar(ctx);
        self.sidebar(ctx, &data, now);
        self.central(ctx, &data, now);
        self.modals(ctx, &data);
        self.handle_drops(ctx, &data);
        self.overlays(ctx);
        self.resize_edges(ctx);
        ctx.request_repaint_after(std::time::Duration::from_millis(1000));
    }
}
