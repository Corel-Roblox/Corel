#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod images;
mod oauth;
mod relay;
mod roblox;
mod scheduler;
mod store;
mod ui;

use std::sync::atomic::{AtomicIsize, Ordering};

/// The main window's HWND, so the tray can show it even while egui is idle.
pub static HWND: AtomicIsize = AtomicIsize::new(0);

pub fn show_window() {
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    let h = HWND.load(Ordering::Relaxed);
    if h != 0 {
        unsafe {
            let hwnd = h as windows_sys::Win32::Foundation::HWND;
            ShowWindow(hwnd, SW_SHOW);
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
            SetForegroundWindow(hwnd);
        }
    }
}

pub fn hide_window() {
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    let h = HWND.load(Ordering::Relaxed);
    if h != 0 {
        unsafe { ShowWindow(h as windows_sys::Win32::Foundation::HWND, SW_HIDE) };
    }
}

pub fn notify(title: &str, body: &str) {
    let (t, b) = (title.to_owned(), body.to_owned());
    std::thread::spawn(move || {
        let _ = notify_rust::Notification::new().appname("Roicon").summary(&t).body(&b).show();
    });
}

pub fn open_url(url: &str) {
    use std::os::windows::process::CommandExt;
    if url.starts_with("https://") {
        let _ = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).creation_flags(0x0800_0000).spawn();
    }
}

pub fn set_launch_at_login(on: bool) {
    let Ok(run) = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER).open_subkey_with_flags("Software\\Microsoft\\Windows\\CurrentVersion\\Run", winreg::enums::KEY_SET_VALUE) else { return };
    if on {
        if let Ok(exe) = std::env::current_exe() {
            let _ = run.set_value("Roicon", &format!("\"{}\" --hidden", exe.display()));
        }
    } else {
        let _ = run.delete_value("Roicon");
    }
}

fn single_instance() -> bool {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    let name: Vec<u16> = "Local\\RoiconSingleInstance\0".encode_utf16().collect();
    unsafe {
        CreateMutexW(std::ptr::null(), 1, name.as_ptr());
        GetLastError() != ERROR_ALREADY_EXISTS
    }
}

fn bring_existing_to_front() {
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    let title: Vec<u16> = "Roicon\0".encode_utf16().collect();
    unsafe {
        let h = FindWindowW(std::ptr::null(), title.as_ptr());
        if !h.is_null() {
            ShowWindow(h, SW_SHOW);
            ShowWindow(h, SW_RESTORE);
            SetForegroundWindow(h);
        }
    }
}

fn main() -> eframe::Result {
    // `roicon.exe --export-logo <folder>` writes the logo as PNG and ICO.
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--export-logo") {
        let dir = std::path::PathBuf::from(args.get(i + 1).cloned().unwrap_or_else(|| ".".into()));
        let _ = std::fs::create_dir_all(&dir);
        let _ = images::app_icon(1024).save(dir.join("roicon-logo.png"));
        let _ = image::imageops::resize(&images::app_icon(1024), 256, 256, image::imageops::FilterType::Lanczos3).save(dir.join("roicon.ico"));
        return Ok(());
    }
    // `roicon.exe --preview-overlay <icon.png> <out.png> "5 Hours"` renders a countdown icon.
    if let Some(i) = args.iter().position(|a| a == "--preview-overlay") {
        if let (Some(src), Some(out)) = (args.get(i + 1), args.get(i + 2)) {
            let label = args.get(i + 3).cloned().unwrap_or_else(|| "5 Hours".into());
            let base = std::fs::read(src).ok();
            let _ = images::composite(base.as_deref(), None, &label).save(out);
        }
        return Ok(());
    }
    // `roicon.exe --check-signin <file>` refreshes the Roblox sign-in once and writes
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
        return Ok(());
    }
    // A separate data folder (ROICON_DATA, used for testing) may run next to the normal app.
    if std::env::var_os("ROICON_DATA").is_none() && !single_instance() {
        bring_existing_to_front();
        return Ok(());
    }
    let hidden = std::env::args().any(|a| a == "--hidden");
    let store = store::Store::open();
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

    let icon = images::app_icon(64);
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Roicon")
            .with_inner_size([1200.0, 780.0])
            .with_min_inner_size([980.0, 640.0])
            .with_decorations(false)
            .with_resizable(true)
            .with_visible(!hidden)
            .with_icon(egui::IconData { rgba: icon.into_raw(), width: 64, height: 64 }),
        persist_window: true,
        ..Default::default()
    };
    eframe::run_native("Roicon", options, Box::new(move |cc| Ok(Box::new(app::App::new(cc, store, sched)))))
}
