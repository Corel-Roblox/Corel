//! Persistent local data for the publishing engine (JSON) plus icon image files in
//! %APPDATA%\Corel. Data from the old Roicon folder is migrated on first start.
//! The Open Cloud API key and the Roblox sign-in live in Windows Credential Manager.

use rand::Rng;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn uid() -> String {
    let mut b = [0u8; 8];
    rand::rng().fill(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    pub close_to_tray: bool,
    pub launch_at_login: bool,
    pub notifications: bool,
    /// Show times as 18:00 instead of 6:00 PM. Off by default.
    pub use_24h: bool,
    /// Download new Corel versions from GitHub automatically.
    pub auto_update: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self { close_to_tray: true, launch_at_login: true, notifications: true, use_24h: false, auto_update: true }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Account {
    pub user_id: Option<String>,
    pub name: Option<String>,
    pub display_name: Option<String>,
    pub key_name: Option<String>,
    /// "oauth" (Sign in with Roblox) or "apikey"
    pub method: String,
    /// Avatar image file
    pub avatar: Option<String>,
    /// Accounts / groups granted on the Roblox consent page
    pub granted: Vec<Granted>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Granted {
    pub kind: String,
    pub id: String,
    pub name: String,
    pub avatar: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Creator {
    pub kind: String, // "User" | "Group"
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Place {
    pub id: String,
    pub name: String,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Timer {
    pub id: String,
    pub hours: f64,
    pub label: String,
    pub overlay: Option<String>,
}

impl Timer {
    pub fn tag(&self) -> String {
        format!("H-{}", fmt_hours(self.hours))
    }
}

pub fn fmt_hours(h: f64) -> String {
    if (h - h.round()).abs() < 1e-6 { format!("{}", h.round() as i64) } else { format!("{h:.1}") }
}

pub fn default_timers() -> Vec<Timer> {
    [12.0, 6.0, 3.0, 1.0]
        .into_iter()
        .map(|h: f64| Timer { id: uid(), hours: h, label: format!("{} Hour{}", fmt_hours(h), if h == 1.0 { "" } else { "s" }), overlay: None })
        .collect()
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Preparing,
    Scheduled,
    Restoring,
    Done,
    Cancelled,
}
impl Status {
    pub fn active(self) -> bool {
        matches!(self, Status::Preparing | Status::Scheduled | Status::Restoring)
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Upload {
    Pending,
    Uploading,
    Done,
    Error,
    Skipped,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Apply {
    Upcoming,
    Waiting,
    Retrying,
    Live,
    Done,
    Skipped,
    Error,
    Standby,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Step {
    pub id: String,
    pub key: String,
    pub label: String,
    pub at: Option<i64>,
    #[serde(default)]
    pub hidden: bool,
    pub image: String,
    pub asset_id: Option<String>,
    pub upload: Upload,
    /// Roblox moderation state: pending | Reviewing | Approved | Rejected | skipped
    pub moderation: String,
    pub apply: Apply,
    #[serde(default)]
    pub places_done: Vec<String>,
    pub error: Option<String>,
    #[serde(default)]
    pub tries: u32,
    #[serde(default)]
    pub retry_at: i64,
    #[serde(default)]
    pub mod_checked_at: i64,
    pub applied_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LogItem {
    pub t: i64,
    pub msg: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Update {
    pub id: String,
    pub at: i64,
    pub started_at: i64,
    pub place_ids: Vec<String>,
    pub place_names: Vec<String>,
    pub status: Status,
    pub steps: Vec<Step>,
    #[serde(default)]
    pub log: Vec<LogItem>,
    pub finished_at: Option<i64>,
}

impl Update {
    pub fn visible(&self) -> impl Iterator<Item = &Step> {
        self.steps.iter().filter(|s| !s.hidden)
    }
    pub fn live_step(&self) -> Option<&Step> {
        self.visible().filter(|s| matches!(s.apply, Apply::Live | Apply::Done)).last()
    }
    pub fn next_step(&self) -> Option<&Step> {
        self.visible().find(|s| matches!(s.apply, Apply::Upcoming | Apply::Waiting | Apply::Retrying))
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HistoryItem {
    pub id: String,
    pub at: i64,
    pub status: Status,
    pub finished_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Experience {
    pub id: String,
    pub universe_id: String,
    pub root_place_id: String,
    pub name: String,
    pub creator: Creator,
    pub rating: Option<u32>,
    #[serde(default)]
    pub playing: u64,
    pub places: Vec<Place>,
    pub current_icon: Option<String>,
    pub new_icon: Option<String>,
    pub timers: Vec<Timer>,
    pub planned_at: Option<i64>,
    pub update: Option<Update>,
    #[serde(default)]
    pub history: Vec<HistoryItem>,
    /// The Corel project (shared workspace) this experience belongs to.
    #[serde(default)]
    pub project_id: Option<String>,
    /// Update announcement shown in the preview and shared with the team.
    #[serde(default)]
    pub announce_title: String,
    #[serde(default)]
    pub announce_body: String,
}

impl Experience {
    pub fn enabled_places(&self) -> Vec<&Place> {
        self.places.iter().filter(|p| p.enabled).collect()
    }
    pub fn active_update(&self) -> Option<&Update> {
        self.update.as_ref().filter(|u| u.status.active())
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Data {
    pub settings: Settings,
    pub account: Option<Account>,
    pub experiences: Vec<Experience>,
    pub selected: Option<String>,
    pub relay_token: String,
    pub tray_hint_shown: bool,
    pub oauth_client_id: Option<String>,
}

impl Data {
    pub fn exp(&self, id: &str) -> Option<&Experience> {
        self.experiences.iter().find(|e| e.id == id)
    }
    pub fn exp_mut(&mut self, id: &str) -> Option<&mut Experience> {
        self.experiences.iter_mut().find(|e| e.id == id)
    }
    pub fn any_active(&self) -> bool {
        self.experiences.iter().any(|e| e.active_update().is_some())
    }
}

/// Shared handle used by the UI, the scheduler and the phone relay.
#[derive(Clone)]
pub struct Store {
    inner: Arc<Mutex<Data>>,
    pub dir: PathBuf,
    pub img_dir: PathBuf,
    version: Arc<std::sync::atomic::AtomicU64>,
    on_change: Arc<Mutex<Option<Box<dyn Fn() + Send + Sync>>>>,
    auth: Arc<Mutex<AuthCache>>,
}

/// Secrets, loaded once from Windows Credential Manager and kept in memory.
#[derive(Default)]
struct AuthCache {
    api_key: Option<String>,
    refresh: Option<String>,
    access: Option<(String, i64)>,
    secret: Option<String>,
}

const KEYRING_SERVICE: &str = "Corel";
const LEGACY_KEYRING_SERVICE: &str = "Roicon";
const KEYRING_USER: &str = "roblox-open-cloud-api-key";
const KEYRING_REFRESH: &str = "roblox-oauth-refresh-token";

fn kr(user: &str) -> Option<keyring::Entry> {
    // Test copies (COREL_NO_KEYRING) never see the real saved sign-in.
    if std::env::var_os("COREL_NO_KEYRING").is_some() {
        return None;
    }
    keyring::Entry::new(KEYRING_SERVICE, user).ok()
}
fn kr_get(user: &str) -> Option<String> {
    if let Some(v) = kr(user).and_then(|e| e.get_password().ok()).filter(|k| !k.is_empty()) {
        return Some(v);
    }
    // Migrate secrets saved by Roicon (same Windows account) into Corel's entry.
    if std::env::var_os("COREL_NO_KEYRING").is_some() {
        return None;
    }
    let legacy = keyring::Entry::new(LEGACY_KEYRING_SERVICE, user).ok()?;
    let v = legacy.get_password().ok().filter(|k| !k.is_empty())?;
    kr_set(user, Some(&v));
    Some(v)
}
fn kr_set(user: &str, v: Option<&str>) {
    if let Some(e) = kr(user) {
        match v {
            Some(v) => {
                let _ = e.set_password(v);
            }
            None => {
                let _ = e.delete_credential();
            }
        }
    }
}

impl Store {
    pub fn open() -> Store {
        let dir = data_dir();
        let img_dir = dir.join("images");
        migrate_legacy(&dir);
        let _ = fs::create_dir_all(&img_dir);
        let mut data: Data = fs::read_to_string(dir.join("store.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        if data.relay_token.is_empty() {
            data.relay_token = random_token();
        }
        let auth = AuthCache { api_key: kr_get(KEYRING_USER), refresh: kr_get(KEYRING_REFRESH), access: None, secret: None };
        Store { inner: Arc::new(Mutex::new(data)), dir, img_dir, version: Default::default(), on_change: Default::default(), auth: Arc::new(Mutex::new(auth)) }
    }

    /// Called after every change (the desktop shell forwards it to the UI as an event).
    pub fn set_on_change(&self, f: impl Fn() + Send + Sync + 'static) {
        *self.on_change.lock().unwrap() = Some(Box::new(f));
    }

    pub fn lock(&self) -> MutexGuard<'_, Data> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn version(&self) -> u64 {
        self.version.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Mutate, then persist and wake the UI.
    pub fn update<R>(&self, f: impl FnOnce(&mut Data) -> R) -> R {
        let r;
        let json;
        {
            let mut d = self.lock();
            r = f(&mut d);
            json = serde_json::to_string_pretty(&*d).unwrap_or_default();
        }
        let tmp = self.dir.join("store.json.tmp");
        if fs::write(&tmp, json).is_ok() {
            let _ = fs::rename(&tmp, self.dir.join("store.json"));
        }
        self.version.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        if let Some(f) = self.on_change.lock().unwrap().as_ref() {
            f();
        }
        r
    }

    // ---------- credentials ----------
    pub fn has_credential(&self) -> bool {
        let a = self.auth.lock().unwrap();
        a.refresh.is_some() || a.api_key.is_some()
    }
    pub fn uses_oauth(&self) -> bool {
        self.auth.lock().unwrap().refresh.is_some()
    }
    pub fn api_key(&self) -> Option<String> {
        self.auth.lock().unwrap().api_key.clone()
    }
    pub fn set_api_key(&self, key: &str) -> Result<(), String> {
        kr(KEYRING_USER).ok_or("Windows Credential Manager is not available.")?.set_password(key).map_err(|e| e.to_string())?;
        self.auth.lock().unwrap().api_key = Some(key.to_owned());
        Ok(())
    }
    pub fn clear_api_key(&self) {
        kr_set(KEYRING_USER, None);
        self.auth.lock().unwrap().api_key = None;
    }
    pub fn oauth_secret(&self) -> Option<String> {
        crate::oauth::embedded_secret()
    }
    pub fn oauth_refresh_token(&self) -> Option<String> {
        self.auth.lock().unwrap().refresh.clone()
    }
    pub fn set_oauth_tokens(&self, t: Option<&crate::oauth::TokenSet>) {
        let mut a = self.auth.lock().unwrap();
        match t {
            Some(t) => {
                kr_set(KEYRING_REFRESH, Some(&t.refresh));
                a.refresh = Some(t.refresh.clone());
                a.access = Some((t.access.clone(), t.expires_at));
            }
            None => {
                kr_set(KEYRING_REFRESH, None);
                a.refresh = None;
                a.access = None;
            }
        }
    }

    /// A ready-to-use credential: Sign in with Roblox (refreshing the 15-minute
    /// access token when needed) or, if not signed in, the API key.
    pub fn credential(&self) -> Result<crate::roblox::Cred, String> {
        let mut a = self.auth.lock().unwrap();
        if let Some(rt) = a.refresh.clone() {
            if let Some((tok, exp)) = &a.access {
                if *exp - 60_000 > now_ms() {
                    return Ok(crate::roblox::Cred::bearer(tok));
                }
            }
            // Refresh tokens are single-use, so refresh while holding the lock.
            match crate::oauth::refresh(self, &rt) {
                Ok(t) => {
                    kr_set(KEYRING_REFRESH, Some(&t.refresh));
                    a.refresh = Some(t.refresh.clone());
                    a.access = Some((t.access.clone(), t.expires_at));
                    return Ok(crate::roblox::Cred::bearer(&t.access));
                }
                Err(e) if e.contains("(400)") || e.contains("(401)") => {
                    kr_set(KEYRING_REFRESH, None);
                    a.refresh = None;
                    a.access = None;
                    drop(a);
                    self.update(|d| if let Some(acc) = d.account.as_mut() { acc.method = "expired".into() });
                    return Err("Your Roblox sign-in expired. Connect again in Settings.".into());
                }
                Err(e) => return Err(e),
            }
        }
        if let Some(k) = a.api_key.clone() {
            return Ok(crate::roblox::Cred::api_key(&k));
        }
        Err("Connect your Roblox account first (Settings → Integrations).".into())
    }

    // ---------- images ----------
    pub fn put_image(&self, png: &[u8]) -> String {
        let name = format!("{}.png", uid());
        let _ = fs::write(self.img_dir.join(&name), png);
        name
    }
    pub fn read_image(&self, name: &str) -> Option<Vec<u8>> {
        let ok = name.len() == 20 && name.ends_with(".png") && name[..16].chars().all(|c| c.is_ascii_hexdigit());
        if !ok {
            return None;
        }
        fs::read(self.img_dir.join(name)).ok()
    }
}

pub fn random_token() -> String {
    use base64::Engine;
    let mut b = [0u8; 18];
    rand::rng().fill(&mut b);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

/// %APPDATA%\\Corel (COREL_DATA overrides it for test copies).
pub fn data_dir() -> PathBuf {
    std::env::var_os("COREL_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("Corel"))
}

/// First start after upgrading from Roicon: copy its experiences, schedules and images over.
/// The old folder is left in place so nothing is lost.
fn migrate_legacy(dir: &std::path::Path) {
    if dir.join("store.json").exists() || std::env::var_os("COREL_DATA").is_some() {
        return;
    }
    let Some(old) = dirs::config_dir().map(|d| d.join("Roicon")) else { return };
    if !old.join("store.json").exists() {
        return;
    }
    let _ = fs::create_dir_all(dir.join("images"));
    let _ = fs::copy(old.join("store.json"), dir.join("store.json"));
    if let Ok(rd) = fs::read_dir(old.join("images")) {
        for f in rd.flatten() {
            let _ = fs::copy(f.path(), dir.join("images").join(f.file_name()));
        }
    }
    let _ = fs::write(dir.join("migrated-from-roicon"), now_ms().to_string());
}
