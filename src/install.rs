//! Self-installer, uninstaller and auto-updater.
//!
//! Running Roicon.exe from anywhere else (e.g. Downloads) installs it to
//! %LOCALAPPDATA%\Programs\Roicon, adds Desktop and Start menu shortcuts and an
//! "Apps & features" entry, then starts the installed copy. The installed copy
//! checks GitHub releases and swaps in newer versions by itself.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

const REPO: &str = "jakedev2/Roicon";
const EXE: &str = "Roicon.exe";
const UNINSTALL_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Roicon";
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Set once a newer version has been downloaded and swapped in; holds its version.
pub static UPDATE_READY: Mutex<Option<String>> = Mutex::new(None);

/// ROICON_INSTALL_DIR (testing only) installs somewhere harmless, without
/// touching shortcuts or the registry.
fn test_dir() -> Option<PathBuf> {
    std::env::var_os("ROICON_INSTALL_DIR").map(PathBuf::from)
}

pub fn install_dir() -> PathBuf {
    test_dir().unwrap_or_else(|| dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("Programs").join("Roicon"))
}

pub fn installed_exe() -> PathBuf {
    install_dir().join(EXE)
}

fn same_path(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()).to_string_lossy().to_lowercase();
    norm(a) == norm(b)
}

pub fn is_installed_copy() -> bool {
    std::env::current_exe().map(|e| same_path(&e, &installed_exe())).unwrap_or(false)
}

/// Release builds started from outside the install folder install themselves,
/// unless started with --portable (or as a ROICON_DATA test copy).
pub fn should_self_install(args: &[String]) -> bool {
    if cfg!(debug_assertions) && test_dir().is_none() {
        return false;
    }
    if args.iter().any(|a| a == "--portable") || (std::env::var_os("ROICON_DATA").is_some() && test_dir().is_none()) {
        return false;
    }
    !is_installed_copy()
}

// ---------------------------------------------------------------- running instance

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

const MUTEX_NAME: &str = "Local\\RoiconSingleInstance";
const QUIT_EVENT: &str = "Local\\RoiconQuit";

/// Takes the single-instance lock. With `wait`, keeps trying for a few seconds
/// (used right after an update restart while the old process is exiting).
pub fn single_instance(wait: bool) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    let name = wide(MUTEX_NAME);
    let tries = if wait { 50 } else { 1 };
    for i in 0..tries {
        unsafe {
            let h = CreateMutexW(std::ptr::null(), 1, name.as_ptr());
            if GetLastError() != ERROR_ALREADY_EXISTS {
                return true; // handle intentionally kept for the life of the process
            }
            if !h.is_null() {
                CloseHandle(h);
            }
        }
        if i + 1 < tries {
            std::thread::sleep(Duration::from_millis(200));
        }
    }
    false
}

fn instance_running() -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenMutexW, SYNCHRONIZATION_SYNCHRONIZE};
    let name = wide(MUTEX_NAME);
    unsafe {
        let h = OpenMutexW(SYNCHRONIZATION_SYNCHRONIZE, 0, name.as_ptr());
        if h.is_null() {
            false
        } else {
            CloseHandle(h);
            true
        }
    }
}

/// Lets a newer copy (installer / uninstaller) ask this running instance to exit.
pub fn listen_for_quit() {
    std::thread::spawn(|| {
        use windows_sys::Win32::System::Threading::{CreateEventW, WaitForSingleObject, INFINITE};
        let name = wide(QUIT_EVENT);
        unsafe {
            let h = CreateEventW(std::ptr::null(), 1, 0, name.as_ptr());
            if !h.is_null() {
                WaitForSingleObject(h, INFINITE);
                std::process::exit(0);
            }
        }
    });
}

/// Asks a running Roicon to quit and waits for it. Older versions (1.1.x) don't
/// listen, so the user is asked to quit them from the tray.
fn close_running_instance() {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenEventW, SetEvent, EVENT_MODIFY_STATE};
    if !instance_running() {
        return;
    }
    let name = wide(QUIT_EVENT);
    unsafe {
        let h = OpenEventW(EVENT_MODIFY_STATE, 0, name.as_ptr());
        if !h.is_null() {
            SetEvent(h);
            CloseHandle(h);
        }
    }
    for _ in 0..30 {
        if !instance_running() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    for _ in 0..2 {
        if !instance_running() {
            return;
        }
        rfd::MessageDialog::new()
            .set_title("Roicon")
            .set_description("An older Roicon is still running.\n\nRight-click the Roicon icon in the taskbar tray, choose Quit, then click OK to finish installing.")
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
    }
}

// ---------------------------------------------------------------- install

fn start_menu_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("Microsoft\\Windows\\Start Menu\\Programs"))
}

fn shortcut_paths() -> Vec<PathBuf> {
    if let Some(t) = test_dir() {
        return vec![t.join("Roicon (desktop).lnk")];
    }
    let mut v = Vec::new();
    if let Some(d) = dirs::desktop_dir() {
        v.push(d.join("Roicon.lnk"));
    }
    if let Some(d) = start_menu_dir() {
        v.push(d.join("Roicon.lnk"));
    }
    v
}

fn make_shortcut(target: &Path, at: &Path) -> Result<(), String> {
    let mut l = mslnk::ShellLink::new(target).map_err(|e| e.to_string())?;
    l.set_name(Some("Roicon".into()));
    l.set_working_dir(target.parent().map(|p| p.to_string_lossy().into_owned()));
    l.set_icon_location(Some(target.to_string_lossy().into_owned()));
    l.create_lnk(at).map_err(|e| e.to_string())
}

fn write_uninstall_entry(exe: &Path) {
    if test_dir().is_some() {
        return;
    }
    use winreg::enums::HKEY_CURRENT_USER;
    let Ok((k, _)) = winreg::RegKey::predef(HKEY_CURRENT_USER).create_subkey(UNINSTALL_KEY) else { return };
    let exe_s = exe.to_string_lossy().into_owned();
    let size_kb = std::fs::metadata(exe).map(|m| (m.len() / 1024) as u32).unwrap_or(0);
    let _ = k.set_value("DisplayName", &"Roicon");
    let _ = k.set_value("DisplayVersion", &VERSION);
    let _ = k.set_value("Publisher", &"Roicon");
    let _ = k.set_value("DisplayIcon", &exe_s);
    let _ = k.set_value("InstallLocation", &install_dir().to_string_lossy().into_owned());
    let _ = k.set_value("UninstallString", &format!("\"{exe_s}\" --uninstall"));
    let _ = k.set_value("URLInfoAbout", &"https://jakedev2.github.io/Roicon/");
    let _ = k.set_value("NoModify", &1u32);
    let _ = k.set_value("NoRepair", &1u32);
    let _ = k.set_value("EstimatedSize", &size_kb);
}

/// Copies this exe into the install folder, adds shortcuts, then starts it.
pub fn run_installer() {
    let Ok(me) = std::env::current_exe() else { return };
    let dir = install_dir();
    let target = installed_exe();
    close_running_instance();
    let res = (|| -> Result<(), String> {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        if target.exists() {
            // A running exe can be renamed but not overwritten.
            let old = dir.join("Roicon.old.exe");
            let _ = std::fs::remove_file(&old);
            let _ = std::fs::rename(&target, &old);
        }
        std::fs::copy(&me, &target).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(e) = res {
        rfd::MessageDialog::new()
            .set_title("Roicon")
            .set_description(format!("Roicon couldn't be installed:\n{e}\n\nIt will run from here instead."))
            .set_level(rfd::MessageLevel::Warning)
            .show();
        let _ = std::process::Command::new(&me).arg("--portable").spawn();
        return;
    }
    for lnk in shortcut_paths() {
        let _ = make_shortcut(&target, &lnk);
    }
    write_uninstall_entry(&target);
    let _ = std::process::Command::new(&target).arg("--after-update").spawn();
}

/// Removes any leftover from a previous update or install.
pub fn cleanup_old() {
    if let Ok(me) = std::env::current_exe() {
        if let Some(d) = me.parent() {
            let _ = std::fs::remove_file(d.join("Roicon.old.exe"));
            let _ = std::fs::remove_file(d.join("Roicon.new.exe"));
        }
    }
    // Keep the version in "Apps & features" current after auto-updates.
    if is_installed_copy() {
        write_uninstall_entry(&installed_exe());
    }
}

// ---------------------------------------------------------------- uninstall

pub fn run_uninstaller() {
    let r = rfd::MessageDialog::new()
        .set_title("Uninstall Roicon")
        .set_description("Remove Roicon from this PC?\n\nScheduled updates will stop. Your experiences and settings are kept in case you install it again.")
        .set_buttons(rfd::MessageButtons::OkCancelCustom("Uninstall".into(), "Cancel".into()))
        .show();
    if r != rfd::MessageDialogResult::Custom("Uninstall".into()) {
        return;
    }
    close_running_instance();
    for lnk in shortcut_paths() {
        let _ = std::fs::remove_file(lnk);
    }
    crate::set_launch_at_login(false);
    if test_dir().is_none() {
        let _ = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER).delete_subkey_all(UNINSTALL_KEY);
    }
    // This exe is inside the folder, so delete it a moment after we exit.
    use std::os::windows::process::CommandExt;
    let dir = install_dir();
    let _ = std::process::Command::new("cmd")
        .raw_arg(format!("/c ping 127.0.0.1 -n 3 >nul & rmdir /s /q \"{}\"", dir.display()))
        .creation_flags(0x0800_0000)
        .spawn();
}

// ---------------------------------------------------------------- auto-update

fn parse_ver(s: &str) -> Vec<u32> {
    s.trim().trim_start_matches(['v', 'V']).split('.').map(|p| p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0)).collect()
}

fn newer(remote: &str, local: &str) -> bool {
    let (mut a, mut b) = (parse_ver(remote), parse_ver(local));
    let n = a.len().max(b.len());
    a.resize(n, 0);
    b.resize(n, 0);
    a > b
}

/// Checks GitHub for a newer release; if there is one, downloads it and swaps it
/// in next to the running exe. Returns the new version when it did.
pub fn check_and_download(local: &str) -> Result<Option<String>, String> {
    let http = reqwest::blocking::Client::builder().user_agent(format!("Roicon/{VERSION}")).timeout(Duration::from_secs(120)).build().map_err(|e| e.to_string())?;
    let rel: serde_json::Value = http
        .get(format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;
    let tag = rel["tag_name"].as_str().unwrap_or_default().to_string();
    if tag.is_empty() || !newer(&tag, local) {
        return Ok(None);
    }
    let asset = rel["assets"].as_array().and_then(|a| a.iter().find(|x| x["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(EXE)))).ok_or("release has no Roicon.exe")?;
    let url = asset["browser_download_url"].as_str().ok_or("no download url")?;
    if !url.starts_with(&format!("https://github.com/{REPO}/releases/download/")) {
        return Err("unexpected download url".into());
    }
    let size = asset["size"].as_u64().unwrap_or(0);
    let bytes = http.get(url).send().and_then(|r| r.error_for_status()).and_then(|r| r.bytes()).map_err(|e| e.to_string())?;
    if bytes.len() < 1_000_000 || (size > 0 && bytes.len() as u64 != size) || !bytes.starts_with(b"MZ") {
        return Err("download was incomplete".into());
    }
    let me = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = me.parent().ok_or("no folder")?;
    let new = dir.join("Roicon.new.exe");
    let old = dir.join("Roicon.old.exe");
    std::fs::write(&new, &bytes).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&old);
    std::fs::rename(&me, &old).map_err(|e| e.to_string())?;
    if let Err(e) = std::fs::rename(&new, &me) {
        let _ = std::fs::rename(&old, &me);
        return Err(e.to_string());
    }
    Ok(Some(tag.trim_start_matches('v').to_string()))
}

/// Starts the (already swapped-in) new exe and exits this one.
pub fn restart(hidden: bool) {
    if let Ok(me) = std::env::current_exe() {
        // current_exe still names Roicon.exe, which is now the new version.
        let mut c = std::process::Command::new(&me);
        c.arg("--after-update");
        if hidden {
            c.arg("--hidden");
        }
        if c.spawn().is_ok() {
            std::process::exit(0);
        }
    }
}

fn window_visible() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::IsWindowVisible;
    let h = crate::HWND.load(std::sync::atomic::Ordering::Relaxed);
    h != 0 && unsafe { IsWindowVisible(h as windows_sys::Win32::Foundation::HWND) } != 0
}

/// Background updater for the installed copy: checks shortly after start, then every 6 hours.
pub fn spawn_updater(store: crate::store::Store) {
    let enabled = (is_installed_copy() && !cfg!(debug_assertions)) || std::env::var_os("ROICON_UPDATE_TEST").is_some();
    if !enabled {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(15));
        loop {
            if store.lock().settings.auto_update && UPDATE_READY.lock().unwrap().is_none() {
                if let Ok(Some(v)) = check_and_download(VERSION) {
                    *UPDATE_READY.lock().unwrap() = Some(v.clone());
                    if !window_visible() {
                        // Running quietly in the tray: switch over right away.
                        restart(true);
                    }
                    if store.lock().settings.notifications {
                        crate::notify("Roicon update ready", &format!("Version {v} is downloaded. Restart Roicon to use it."));
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(6 * 3600));
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn versions() {
        assert!(super::newer("v1.2.0", "1.1.2"));
        assert!(super::newer("v1.10.0", "1.9.9"));
        assert!(!super::newer("v1.1.2", "1.1.2"));
        assert!(!super::newer("v1.1.1", "1.1.2"));
    }
}
