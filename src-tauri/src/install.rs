//! Self-installer, uninstaller and auto-updater.
//!
//! Running Corel.exe from anywhere else (e.g. Downloads) installs it to
//! %LOCALAPPDATA%\Programs\Corel, adds Desktop and Start menu shortcuts, an
//! "Apps & features" entry and the corel:// link handler (used by team invite
//! links), then starts the installed copy. The installed copy checks GitHub
//! releases and swaps in newer versions by itself.
//!
//! When this binary starts from an old Roicon folder it installs itself as Corel
//! and removes Roicon's shortcuts, startup entry and uninstall entry.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

const REPO: &str = "Corel-Roblox/Corel";
/// Earlier homes of the repository; GitHub redirects them, so downloads may come from either.
const OLD_REPOS: &[&str] = &["jakedev2/Corel"];
const EXE: &str = "Corel.exe";
const UNINSTALL_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Corel";
const LEGACY_UNINSTALL_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Roicon";
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Set once a newer version has been downloaded and swapped in; holds its version.
pub static UPDATE_READY: Mutex<Option<String>> = Mutex::new(None);

/// COREL_INSTALL_DIR (testing only) installs somewhere harmless, without
/// touching shortcuts or the registry.
fn test_dir() -> Option<PathBuf> {
    std::env::var_os("COREL_INSTALL_DIR").map(PathBuf::from)
}

pub fn install_dir() -> PathBuf {
    test_dir().unwrap_or_else(|| dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("Programs").join("Corel"))
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
/// unless started with --portable (or as a COREL_DATA test copy).
pub fn should_self_install(args: &[String]) -> bool {
    if cfg!(debug_assertions) && test_dir().is_none() {
        return false;
    }
    if args.iter().any(|a| a == "--portable") || (std::env::var_os("COREL_DATA").is_some() && test_dir().is_none()) {
        return false;
    }
    !is_installed_copy()
}

// ---------------------------------------------------------------- running instance

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

const MUTEX_NAME: &str = "Local\\CorelSingleInstance";
const QUIT_EVENT: &str = "Local\\CorelQuit";
const LEGACY_QUIT_EVENT: &str = "Local\\RoiconQuit";
const LEGACY_MUTEX_NAME: &str = "Local\\RoiconSingleInstance";
pub const LINK_EVENT: &str = "Local\\CorelOpenLink";

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
    mutex_exists(MUTEX_NAME)
}

fn mutex_exists(mutex: &str) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenMutexW, SYNCHRONIZATION_SYNCHRONIZE};
    let name = wide(mutex);
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

pub fn signal_event(event: &str) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenEventW, SetEvent, EVENT_MODIFY_STATE};
    let name = wide(event);
    unsafe {
        let h = OpenEventW(EVENT_MODIFY_STATE, 0, name.as_ptr());
        if h.is_null() {
            return false;
        }
        SetEvent(h);
        CloseHandle(h);
        true
    }
}

/// Waits (on a background thread) for another Corel process to hand over a corel:// link.
pub fn listen_for_links(on_link: impl Fn() + Send + 'static) {
    std::thread::spawn(move || {
        use windows_sys::Win32::System::Threading::{CreateEventW, WaitForSingleObject, INFINITE};
        let name = wide(LINK_EVENT);
        unsafe {
            let h = CreateEventW(std::ptr::null(), 0, 0, name.as_ptr());
            if h.is_null() {
                return;
            }
            loop {
                WaitForSingleObject(h, INFINITE);
                on_link();
            }
        }
    });
}

/// Asks a running Corel (or a legacy Roicon) to quit and waits for it.
fn close_running_instance() {
    if mutex_exists(LEGACY_MUTEX_NAME) {
        signal_event(LEGACY_QUIT_EVENT);
        for _ in 0..30 {
            if !mutex_exists(LEGACY_MUTEX_NAME) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    if !instance_running() {
        return;
    }
    signal_event(QUIT_EVENT);
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
            .set_title("Corel")
            .set_description("Corel is still running.\n\nRight-click the Corel icon in the taskbar tray, choose Quit, then click OK to finish installing.")
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
        return vec![t.join("Corel (desktop).lnk")];
    }
    let mut v = Vec::new();
    if let Some(d) = dirs::desktop_dir() {
        v.push(d.join("Corel.lnk"));
    }
    if let Some(d) = start_menu_dir() {
        v.push(d.join("Corel.lnk"));
    }
    v
}

fn legacy_shortcut_paths() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(d) = dirs::desktop_dir() {
        v.push(d.join("Roicon.lnk"));
    }
    if let Some(d) = start_menu_dir() {
        v.push(d.join("Roicon.lnk"));
    }
    v
}

/// Removes what Roicon left behind (shortcuts, startup entry, uninstall entry and
/// its program folder). Its data folder in %APPDATA% is kept; Corel copies it.
fn remove_legacy_roicon() {
    if test_dir().is_some() {
        return;
    }
    for l in legacy_shortcut_paths() {
        let _ = std::fs::remove_file(l);
    }
    let hk = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let _ = hk.delete_subkey_all(LEGACY_UNINSTALL_KEY);
    if let Ok(run) = hk.open_subkey_with_flags("Software\\Microsoft\\Windows\\CurrentVersion\\Run", winreg::enums::KEY_SET_VALUE) {
        let _ = run.delete_value("Roicon");
    }
    let old_dir = dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("Programs").join("Roicon");
    if old_dir.exists() {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("cmd")
            .raw_arg(format!("/c ping 127.0.0.1 -n 4 >nul & rmdir /s /q \"{}\"", old_dir.display()))
            .creation_flags(0x0800_0000)
            .spawn();
    }
}

/// Registers corel:// so team invite links open the app (per user, no admin rights).
pub fn register_link_handler(exe: &Path) {
    if test_dir().is_some() {
        return;
    }
    use winreg::enums::HKEY_CURRENT_USER;
    let Ok((k, _)) = winreg::RegKey::predef(HKEY_CURRENT_USER).create_subkey("Software\\Classes\\corel") else { return };
    let _ = k.set_value("", &"URL:Corel");
    let _ = k.set_value("URL Protocol", &"");
    if let Ok((icon, _)) = k.create_subkey("DefaultIcon") {
        let _ = icon.set_value("", &format!("\"{}\",0", exe.display()));
    }
    if let Ok((cmd, _)) = k.create_subkey("shell\\open\\command") {
        let _ = cmd.set_value("", &format!("\"{}\" \"%1\"", exe.display()));
    }
}

fn make_shortcut(target: &Path, at: &Path) -> Result<(), String> {
    let mut l = mslnk::ShellLink::new(target).map_err(|e| e.to_string())?;
    l.set_name(Some("Corel".into()));
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
    let _ = k.set_value("DisplayName", &"Corel");
    let _ = k.set_value("DisplayVersion", &VERSION);
    let _ = k.set_value("Publisher", &"Corel");
    let _ = k.set_value("DisplayIcon", &exe_s);
    let _ = k.set_value("InstallLocation", &install_dir().to_string_lossy().into_owned());
    let _ = k.set_value("UninstallString", &format!("\"{exe_s}\" --uninstall"));
    let _ = k.set_value("URLInfoAbout", &"https://corel-roblox.github.io/Corel/");
    let _ = k.set_value("Comments", &"The workspace for Roblox development teams");
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
            let old = dir.join("Corel.old.exe");
            let _ = std::fs::remove_file(&old);
            let _ = std::fs::rename(&target, &old);
        }
        std::fs::copy(&me, &target).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(e) = res {
        rfd::MessageDialog::new()
            .set_title("Corel")
            .set_description(format!("Corel couldn't be installed:\n{e}\n\nIt will run from here instead."))
            .set_level(rfd::MessageLevel::Warning)
            .show();
        let _ = std::process::Command::new(&me).arg("--portable").spawn();
        return;
    }
    for lnk in shortcut_paths() {
        let _ = std::fs::remove_file(&lnk);
        let _ = make_shortcut(&target, &lnk);
    }
    write_uninstall_entry(&target);
    register_link_handler(&target);
    remove_legacy_roicon();
    refresh_icons();
    let _ = std::process::Command::new(&target).arg("--after-update").spawn();
}

/// Windows caches icons by file path, and updates replace the exe at the same path,
/// so after an install or update the old icon can keep showing. Re-create the
/// shortcuts and tell the shell the icons changed.
pub fn refresh_icons() {
    use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNE_UPDATEITEM, SHCNF_FLUSHNOWAIT, SHCNF_IDLIST, SHCNF_PATHW};
    let exe = installed_exe();
    for lnk in shortcut_paths() {
        if lnk.exists() || test_dir().is_none() {
            let _ = std::fs::remove_file(&lnk);
            let _ = make_shortcut(&exe, &lnk);
        }
    }
    let mut paths = vec![exe.clone()];
    paths.extend(shortcut_paths());
    unsafe {
        for p in &paths {
            let w = wide(&p.to_string_lossy());
            SHChangeNotify(SHCNE_UPDATEITEM as i32, SHCNF_PATHW | SHCNF_FLUSHNOWAIT, w.as_ptr() as *const _, std::ptr::null());
        }
        SHChangeNotify(SHCNE_ASSOCCHANGED as i32, SHCNF_IDLIST | SHCNF_FLUSHNOWAIT, std::ptr::null(), std::ptr::null());
    }
    // Ask Explorer to rebuild its icon cache (built into Windows 10/11).
    if test_dir().is_none() {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("ie4uinit.exe").arg("-show").creation_flags(0x0800_0000).spawn();
    }
}

fn installed_version() -> Option<String> {
    winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER).open_subkey(UNINSTALL_KEY).ok()?.get_value("DisplayVersion").ok()
}

/// Removes any leftover from a previous update or install.
pub fn cleanup_old() {
    if let Ok(me) = std::env::current_exe() {
        if let Some(d) = me.parent() {
            let _ = std::fs::remove_file(d.join("Corel.old.exe"));
            let _ = std::fs::remove_file(d.join("Corel.new.exe"));
        }
    }
    // First start of a new version: refresh icons, then record the version in "Apps & features".
    if is_installed_copy() {
        if installed_version().as_deref() != Some(VERSION) {
            std::thread::spawn(refresh_icons);
        }
        write_uninstall_entry(&installed_exe());
        register_link_handler(&installed_exe());
    }
}

// ---------------------------------------------------------------- uninstall

pub fn run_uninstaller() {
    let r = rfd::MessageDialog::new()
        .set_title("Uninstall Corel")
        .set_description("Remove Corel from this PC?\n\nScheduled icon updates on this PC will stop. Your team workspace stays online, and local settings are kept in case you install it again.")
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
        let _ = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER).delete_subkey_all("Software\\Classes\\corel");
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
    let http = reqwest::blocking::Client::builder().user_agent(format!("Corel/{VERSION}")).timeout(Duration::from_secs(120)).build().map_err(|e| e.to_string())?;
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
    let asset = rel["assets"].as_array().and_then(|a| a.iter().find(|x| x["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(EXE)))).ok_or("release has no Corel.exe")?;
    let url = asset["browser_download_url"].as_str().ok_or("no download url")?;
    let trusted = std::iter::once(REPO).chain(OLD_REPOS.iter().copied()).any(|r| url.starts_with(&format!("https://github.com/{r}/releases/download/")));
    if !trusted {
        return Err("unexpected download url".into());
    }
    let size = asset["size"].as_u64().unwrap_or(0);
    let bytes = http.get(url).send().and_then(|r| r.error_for_status()).and_then(|r| r.bytes()).map_err(|e| e.to_string())?;
    if bytes.len() < 1_000_000 || (size > 0 && bytes.len() as u64 != size) || !bytes.starts_with(b"MZ") {
        return Err("download was incomplete".into());
    }
    let me = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = me.parent().ok_or("no folder")?;
    let new = dir.join("Corel.new.exe");
    let old = dir.join("Corel.old.exe");
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
        // current_exe still names Corel.exe, which is now the new version.
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
    crate::main_window_visible()
}

/// Background updater for the installed copy: checks shortly after start, then every 6 hours.
pub fn spawn_updater(store: crate::store::Store) {
    let enabled = (is_installed_copy() && !cfg!(debug_assertions)) || std::env::var_os("COREL_UPDATE_TEST").is_some();
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
                        crate::notify("Corel update ready", &format!("Version {v} is downloaded. Restart Corel to use it."));
                    }
                    crate::emit_update_ready(&v);
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
