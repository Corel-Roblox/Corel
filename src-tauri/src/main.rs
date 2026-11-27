#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Corel desktop shell. The UI is a web app (../src) rendered by Tauri; this process
//! owns everything that must run locally: the icon/countdown publishing engine, Roblox
//! sign-in and API calls, encrypted session storage, the tray, the self-installer and
//! the auto-updater.

mod commands;
mod images;
mod install;
mod oauth;
mod relay;
mod roblox;
mod scheduler;
mod secure;
mod store;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

pub static APP: OnceLock<AppHandle> = OnceLock::new();
/// A corel:// link (team invite) waiting for the UI to pick it up.
pub static PENDING_LINK: Mutex<Option<String>> = Mutex::new(None);
pub static START_HIDDEN: AtomicBool = AtomicBool::new(false);

pub fn main_window() -> Option<WebviewWindow> {
    APP.get()?.get_webview_window("main")
}

pub fn show_window() {
    if let Some(w) = main_window() {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn hide_window() {
    if let Some(w) = main_window() {
        let _ = w.hide();
    }
}

pub fn main_window_visible() -> bool {
    main_window().and_then(|w| w.is_visible().ok()).unwrap_or(false)
}

pub fn emit_update_ready(version: &str) {
    if let Some(a) = APP.get() {
        let _ = a.emit("update-ready", version.to_owned());
    }
}

pub fn notify(title: &str, body: &str) {
    let (t, b) = (title.to_owned(), body.to_owned());
    std::thread::spawn(move || {
        let _ = notify_rust::Notification::new().appname("Corel").summary(&t).body(&b).show();
    });
}

/// Opens https:// pages and mailto: links (invites) in the user's default apps.
pub fn open_url(url: &str) {
    use std::os::windows::process::CommandExt;
    if url.starts_with("https://") || url.starts_with("mailto:") {
        let _ = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).creation_flags(0x0800_0000).spawn();
    }
}

pub fn set_launch_at_login(on: bool) {
    let Ok(run) = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER).open_subkey_with_flags("Software\\Microsoft\\Windows\\CurrentVersion\\Run", winreg::enums::KEY_SET_VALUE) else { return };
    if on {
        if let Ok(exe) = std::env::current_exe() {
            let _ = run.set_value("Corel", &format!("\"{}\" --hidden", exe.display()));
        }
    } else {
        let _ = run.delete_value("Corel");
    }
}

fn link_file() -> std::path::PathBuf {
    store::data_dir().join("pending-link.txt")
}

/// Another Corel process handed over a link (or just asked us to come to the front).
fn take_handed_over_link() {
    if let Ok(s) = std::fs::read_to_string(link_file()) {
        let _ = std::fs::remove_file(link_file());
        let s = s.trim().to_owned();
        if s.starts_with("corel://") {
            *PENDING_LINK.lock().unwrap() = Some(s.clone());
            if let Some(a) = APP.get() {
                let _ = a.emit("open-link", s);
            }
        }
    }
    show_window();
}

fn confirm_quit(store: &store::Store) -> bool {
    if !store.lock().any_active() {
        return true;
    }
    let r = rfd::MessageDialog::new()
        .set_title("Corel")
        .set_level(rfd::MessageLevel::Warning)
        .set_description("An icon update is scheduled on this PC. If you quit, icons will not change until you open Corel again.")
        .set_buttons(rfd::MessageButtons::OkCancelCustom("Quit anyway".into(), "Keep running".into()))
        .show();
    r == rfd::MessageDialogResult::Custom("Quit anyway".into())
}

fn build_tray(app: &tauri::App, store: store::Store) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let open = MenuItem::with_id(app, "open", "Open Corel", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &sep, &quit])?;
    let mut b = TrayIconBuilder::with_id("main").tooltip("Corel").menu(&menu).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        b = b.icon(icon.clone());
    }
    b.on_menu_event(move |app, e| match e.id.as_ref() {
        "open" => show_window(),
        "quit" => {
            if confirm_quit(&store) {
                app.exit(0);
            }
        }
        _ => {}
    })
    .on_tray_icon_event(|_tray, e| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
            show_window();
        }
    })
    .build(app)?;
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    // `corel.exe --preview-overlay <icon.png> <out.png> "5 Hours"` renders a countdown icon.
    if let Some(i) = args.iter().position(|a| a == "--preview-overlay") {
        if let (Some(src), Some(out)) = (args.get(i + 1), args.get(i + 2)) {
            let label = args.get(i + 3).cloned().unwrap_or_else(|| "5 Hours".into());
            let base = std::fs::read(src).ok();
            let _ = images::composite(base.as_deref(), None, &label).save(out);
        }
        return;
    }
    // `corel.exe --check-signin <file>` refreshes the Roblox sign-in once and writes
    // "ok" or the error to <file> (no tokens are written). Used to test a build.
    if let Some(i) = args.iter().position(|a| a == "--check-signin") {
        let out = args.get(i + 1).cloned().unwrap_or_else(|| "signin-check.txt".into());
        let store = store::Store::open();
        let res = match store.credential() {
            Ok(c) if c.header == "Authorization" => "ok: signed in with Roblox (token refreshed)".to_string(),
            Ok(_) => "ok: using API key".to_string(),
            Err(e) => format!("error: {e}"),
        };
        let _ = std::fs::write(out, res);
        return;
    }
    // `corel.exe --test-update <pretend-version> <file>`: runs the updater once on this exe (testing).
    if let Some(i) = args.iter().position(|a| a == "--test-update") {
        let v = args.get(i + 1).cloned().unwrap_or_else(|| install::VERSION.into());
        let out = args.get(i + 2).cloned().unwrap_or_else(|| "update-check.txt".into());
        let _ = std::fs::write(out, format!("{:?}", install::check_and_download(&v)));
        return;
    }
    if args.iter().any(|a| a == "--uninstall") {
        install::run_uninstaller();
        return;
    }
    // Run from Downloads (or from an old Roicon folder): install, add shortcuts, start the installed copy.
    if install::should_self_install(&args) {
        install::run_installer();
        return;
    }
    let link = args.iter().find(|a| a.starts_with("corel://")).cloned();
    let after_update = args.iter().any(|a| a == "--after-update");
    if std::env::var_os("COREL_DATA").is_none() && !install::single_instance(after_update) {
        // Already running: hand over the link (if any) and bring that window forward.
        let _ = std::fs::create_dir_all(store::data_dir());
        let _ = std::fs::write(link_file(), link.unwrap_or_default());
        install::signal_event(install::LINK_EVENT);
        return;
    }
    *PENDING_LINK.lock().unwrap() = link;
    START_HIDDEN.store(args.iter().any(|a| a == "--hidden"), Ordering::Relaxed);

    install::listen_for_quit();
    install::cleanup_old();
    let store = store::Store::open();
    install::spawn_updater(store.clone());
    set_launch_at_login(store.lock().settings.launch_at_login);
    let sched = scheduler::Scheduler::new(store.clone());
    sched.spawn();
    // Keep the Roblox profile (name, @username, avatar) up to date on every start.
    if store.uses_oauth() {
        let s = store.clone();
        std::thread::spawn(move || {
            if let Ok(c) = s.credential() {
                if let Some(token) = c.value.strip_prefix("Bearer ") {
                    oauth::load_profile(&s, token);
                }
            }
        });
    }

    let state = commands::AppState::new(store.clone(), sched);
    let img_store = store.clone();
    let close_store = store.clone();
    let tray_store = store.clone();

    tauri::Builder::default()
        .manage(state)
        // Local icon images (current/new icons, countdown steps, avatars) served to the UI
        // as http://timg.localhost/<name>. Names are validated by Store::read_image.
        .register_uri_scheme_protocol("timg", move |_ctx, req| {
            let name = req.uri().path().trim_start_matches('/').to_owned();
            match img_store.read_image(&name) {
                Some(bytes) => tauri::http::Response::builder().header("Content-Type", "image/png").header("Cache-Control", "max-age=31536000, immutable").header("Access-Control-Allow-Origin", "*").body(bytes).unwrap(),
                None => tauri::http::Response::builder().status(404).body(Vec::new()).unwrap(),
            }
        })
        .invoke_handler(commands::handler())
        .setup(move |app| {
            let _ = APP.set(app.handle().clone());
            let h = app.handle().clone();
            store.set_on_change(move || {
                let _ = h.emit("engine-changed", ());
            });
            build_tray(app, tray_store.clone())?;
            install::listen_for_links(take_handed_over_link);
            if !START_HIDDEN.load(Ordering::Relaxed) {
                show_window();
            }
            Ok(())
        })
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let to_tray = close_store.lock().settings.close_to_tray;
                if to_tray {
                    let _ = window.hide();
                    let first = !close_store.lock().tray_hint_shown;
                    if first {
                        close_store.update(|d| d.tray_hint_shown = true);
                        notify("Corel is still running", "Scheduled icon updates will happen on time. Find Corel in the system tray.");
                    }
                } else if confirm_quit(&close_store) {
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Corel");
}
