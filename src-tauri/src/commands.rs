//! Commands the UI calls through Tauri's IPC. Anything that touches Roblox,
//! secrets or the local publishing engine goes through here, so no Roblox token,
//! API key or OAuth secret ever reaches the web view.

use crate::relay::{self, Relay};
use crate::scheduler::{Scheduler, StepInput};
use crate::store::*;
use crate::{images, install, oauth, roblox, secure};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::State;

pub struct AppState {
    pub store: Store,
    pub sched: Scheduler,
    pub relay: Relay,
    pub signin_cancel: Arc<AtomicBool>,
}

impl AppState {
    pub fn new(store: Store, sched: Scheduler) -> Self {
        let relay = Relay::new(store.clone());
        Self { store, sched, relay, signin_cancel: Default::default() }
    }
}

type Res<T> = Result<T, String>;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Res<T> + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

fn b64_decode(data: &str) -> Res<Vec<u8>> {
    let raw = data.split_once(',').map(|(_, d)| d).unwrap_or(data);
    base64::engine::general_purpose::STANDARD.decode(raw.trim()).map_err(|_| "That file could not be read.".to_string())
}

fn png_data_url(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
}

// ------------------------------------------------------------------ app

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    machine: String,
    data_dir: String,
    update_ready: Option<String>,
    installed: bool,
    signin_available: bool,
    migrated_from_roicon: bool,
    started_hidden: bool,
}

#[tauri::command]
fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: install::VERSION.to_owned(),
        machine: std::env::var("COMPUTERNAME").unwrap_or_else(|_| "This PC".into()),
        data_dir: state.store.dir.display().to_string(),
        update_ready: install::UPDATE_READY.lock().unwrap().clone(),
        installed: install::is_installed_copy(),
        signin_available: oauth::embedded_secret().is_some(),
        migrated_from_roicon: state.store.dir.join("migrated-from-roicon").exists(),
        started_hidden: crate::START_HIDDEN.load(Ordering::Relaxed),
    }
}

#[tauri::command]
fn restart_for_update() {
    install::restart(false);
}

#[tauri::command]
fn open_external(url: String) {
    crate::open_url(&url);
}

#[tauri::command]
fn desktop_notify(title: String, body: String) {
    crate::notify(&title, &body);
}

#[tauri::command]
fn take_pending_link() -> Option<String> {
    crate::PENDING_LINK.lock().unwrap().take()
}

#[tauri::command]
fn reveal_data_dir(state: State<'_, AppState>) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("explorer").arg(&state.store.dir).creation_flags(0x0800_0000).spawn();
}

#[tauri::command]
async fn save_text_file(default_name: String, contents: String) -> Res<Option<String>> {
    blocking(move || {
        let Some(path) = rfd::FileDialog::new().set_file_name(&default_name).save_file() else { return Ok(None) };
        std::fs::write(&path, contents).map_err(|e| e.to_string())?;
        Ok(Some(path.display().to_string()))
    })
    .await
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// ------------------------------------------------------------------ secure session storage

#[tauri::command]
fn secure_get(key: String) -> Option<String> {
    secure::get(&key)
}

#[tauri::command]
fn secure_set(key: String, value: String) -> Res<()> {
    secure::set(&key, &value)
}

#[tauri::command]
fn secure_remove(key: String) {
    secure::remove(&key)
}

#[tauri::command]
fn secure_clear() {
    secure::clear_all()
}

// ------------------------------------------------------------------ engine state

/// Local publishing engine state for the UI. Secrets and the relay token are left out.
#[tauri::command]
fn engine_state(state: State<'_, AppState>) -> Value {
    let s = &state.store;
    let d = s.lock();
    json!({
        "settings": d.settings,
        "account": d.account,
        "experiences": d.experiences,
        "hasCredential": s.has_credential(),
        "usesOauth": s.uses_oauth(),
        "hasApiKey": s.api_key().is_some(),
        "now": now_ms(),
    })
}

#[tauri::command]
fn engine_set_settings(state: State<'_, AppState>, patch: Value) {
    let mut login: Option<bool> = None;
    state.store.update(|d| {
        let s = &mut d.settings;
        if let Some(v) = patch["closeToTray"].as_bool() {
            s.close_to_tray = v;
        }
        if let Some(v) = patch["launchAtLogin"].as_bool() {
            s.launch_at_login = v;
            login = Some(v);
        }
        if let Some(v) = patch["notifications"].as_bool() {
            s.notifications = v;
        }
        if let Some(v) = patch["use24h"].as_bool() {
            s.use_24h = v;
        }
        if let Some(v) = patch["autoUpdate"].as_bool() {
            s.auto_update = v;
        }
    });
    if let Some(v) = login {
        crate::set_launch_at_login(v);
    }
}

// ------------------------------------------------------------------ Roblox account

#[tauri::command]
async fn roblox_sign_in(state: State<'_, AppState>) -> Res<()> {
    let (store, cancel) = (state.store.clone(), state.signin_cancel.clone());
    cancel.store(false, Ordering::Relaxed);
    blocking(move || oauth::sign_in(&store, cancel)).await
}

#[tauri::command]
fn roblox_cancel_sign_in(state: State<'_, AppState>) {
    state.signin_cancel.store(true, Ordering::Relaxed);
}

#[tauri::command]
async fn roblox_sign_out(state: State<'_, AppState>) -> Res<()> {
    let store = state.store.clone();
    blocking(move || {
        oauth::sign_out(&store);
        Ok(())
    })
    .await
}

#[tauri::command]
async fn roblox_set_api_key(state: State<'_, AppState>, key: String) -> Res<()> {
    let store = state.store.clone();
    blocking(move || {
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
    })
    .await
}

#[tauri::command]
fn roblox_clear_api_key(state: State<'_, AppState>) {
    state.store.clear_api_key();
    if !state.store.uses_oauth() {
        state.store.update(|d| d.account = None);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolved {
    universe_id: String,
    root_place_id: String,
    name: String,
    creator_kind: String,
    creator_id: String,
    creator_name: String,
    playing: u64,
    icon_url: Option<String>,
}

/// Looks up an experience from a roblox.com link, a place ID or a universe ID.
#[tauri::command]
async fn roblox_resolve(state: State<'_, AppState>, input: String, universe_id: Option<String>) -> Res<Resolved> {
    let store = state.store.clone();
    blocking(move || {
        let uni = match universe_id.map(|u| u.trim().to_owned()).filter(|u| !u.is_empty()) {
            Some(u) if u.chars().all(|c| c.is_ascii_digit()) => u,
            Some(_) => return Err("The universe ID must be a number.".into()),
            None => roblox::universe_from_input(&input).map_err(|e| e.msg)?,
        };
        let acct_user = store.lock().account.as_ref().and_then(|a| a.user_id.clone());
        let g = roblox::resolve_game(&uni, store.credential().ok().as_ref(), acct_user).map_err(|e| e.msg)?;
        let icon_url = roblox::get_game_icon_url(&uni).ok();
        Ok(Resolved { universe_id: g.universe_id, root_place_id: g.root_place_id, name: g.name, creator_kind: g.creator_kind, creator_id: g.creator_id, creator_name: g.creator_name, playing: g.playing, icon_url })
    })
    .await
}

#[tauri::command]
async fn roblox_game_stats(universe_ids: Vec<String>) -> Res<Vec<roblox::GameStats>> {
    let ids: Vec<String> = universe_ids.into_iter().filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit())).collect();
    if ids.is_empty() {
        return Ok(vec![]);
    }
    blocking(move || roblox::get_game_stats(&ids).map_err(|e| e.msg)).await
}

// ------------------------------------------------------------------ experiences (publishing engine)

#[tauri::command]
async fn exp_add(state: State<'_, AppState>, input: String, project_id: Option<String>, universe_id: Option<String>) -> Res<String> {
    let store = state.store.clone();
    blocking(move || {
        // A project's universe ID is used exactly as entered; only free-form input
        // (links, place IDs) goes through the lookup that guesses which kind of ID it is.
        let uid_ = match universe_id.map(|u| u.trim().to_owned()).filter(|u| !u.is_empty()) {
            Some(u) if u.chars().all(|c| c.is_ascii_digit()) => u,
            Some(_) => return Err("The universe ID must be a number.".into()),
            None => roblox::universe_from_input(&input).map_err(|e| e.msg)?,
        };
        if let Some(existing) = store.lock().experiences.iter().find(|e| e.universe_id == uid_) {
            let id = existing.id.clone();
            if project_id.is_some() {
                store.update(|d| if let Some(e) = d.exp_mut(&id) { e.project_id = project_id.clone() });
            }
            return Ok(id);
        }
        let acct_user = store.lock().account.as_ref().and_then(|a| a.user_id.clone());
        let g = roblox::resolve_game(&uid_, store.credential().ok().as_ref(), acct_user).map_err(|e| e.msg)?;
        let places = roblox::get_places(&uid_, &g.root_place_id);
        let rating = roblox::get_rating(&uid_);
        let icon = roblox::get_game_icon_png(&uid_).ok().and_then(|b| images::square_icon(&b).ok()).map(|b| store.put_image(&b));
        let id = uid();
        store.update(|d| {
            d.experiences.push(Experience {
                id: id.clone(),
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
                project_id,
                announce_title: String::new(),
                announce_body: String::new(),
            });
            d.selected = Some(id.clone());
        });
        Ok(id)
    })
    .await
}

#[tauri::command]
fn exp_remove(state: State<'_, AppState>, id: String) -> Res<()> {
    state.store.update(|d| {
        if d.exp(&id).is_some_and(|e| e.active_update().is_some()) {
            return Err("Cancel the running update before removing this experience.".to_string());
        }
        d.experiences.retain(|e| e.id != id);
        Ok(())
    })
}

#[tauri::command]
fn exp_link(state: State<'_, AppState>, id: String, project_id: Option<String>) {
    state.store.update(|d| if let Some(e) = d.exp_mut(&id) { e.project_id = project_id });
}

/// which: "current" | "new". Images are cropped to a square and scaled to 512x512.
#[tauri::command]
async fn exp_set_image(state: State<'_, AppState>, id: String, which: String, data: Option<String>) -> Res<()> {
    let store = state.store.clone();
    blocking(move || {
        let name = match data {
            Some(d) => Some(store.put_image(&images::square_icon(&b64_decode(&d)?)?)),
            None => None,
        };
        store.update(|d| {
            let e = d.exp_mut(&id).ok_or("Experience not found.")?;
            match which.as_str() {
                "current" => e.current_icon = name,
                "new" => e.new_icon = name,
                _ => return Err("Unknown icon slot.".to_string()),
            }
            Ok(())
        })
    })
    .await
}

/// Re-downloads the icon that is live on Roblox right now as the "current" icon.
#[tauri::command]
async fn exp_fetch_current_icon(state: State<'_, AppState>, id: String) -> Res<()> {
    let store = state.store.clone();
    blocking(move || {
        let uni = store.lock().exp(&id).map(|e| e.universe_id.clone()).ok_or("Experience not found.")?;
        let png = roblox::get_game_icon_png(&uni).map_err(|e| e.msg)?;
        let name = store.put_image(&images::square_icon(&png)?);
        store.update(|d| if let Some(e) = d.exp_mut(&id) { e.current_icon = Some(name) });
        Ok(())
    })
    .await
}

#[derive(Deserialize)]
pub struct TimerIn {
    id: Option<String>,
    hours: f64,
    label: String,
}

#[tauri::command]
fn exp_set_timers(state: State<'_, AppState>, id: String, timers: Vec<TimerIn>) -> Res<()> {
    if timers.iter().any(|t| !(t.hours > 0.0 && t.hours <= 24.0 * 14.0)) {
        return Err("Countdown steps must be between a few minutes and 14 days before the update.".into());
    }
    state.store.update(|d| {
        let e = d.exp_mut(&id).ok_or("Experience not found.")?;
        let old = std::mem::take(&mut e.timers);
        let mut next: Vec<Timer> = timers
            .into_iter()
            .map(|t| {
                let prev = t.id.as_ref().and_then(|tid| old.iter().find(|o| &o.id == tid));
                Timer { id: prev.map(|p| p.id.clone()).unwrap_or_else(uid), hours: t.hours, label: t.label.trim().chars().take(24).collect(), overlay: prev.and_then(|p| p.overlay.clone()) }
            })
            .collect();
        next.sort_by(|a, b| b.hours.partial_cmp(&a.hours).unwrap_or(std::cmp::Ordering::Equal));
        e.timers = next;
        Ok(())
    })
}

#[tauri::command]
async fn exp_set_overlay(state: State<'_, AppState>, id: String, timer_id: String, data: Option<String>) -> Res<()> {
    let store = state.store.clone();
    blocking(move || {
        let name = match data {
            Some(d) => Some(store.put_image(&images::fit_overlay(&b64_decode(&d)?)?)),
            None => None,
        };
        store.update(|d| {
            let t = d.exp_mut(&id).and_then(|e| e.timers.iter_mut().find(|t| t.id == timer_id)).ok_or("Countdown step not found.")?;
            t.overlay = name;
            Ok(())
        })
    })
    .await
}

#[tauri::command]
fn exp_set_place(state: State<'_, AppState>, id: String, place_id: String, enabled: bool) {
    state.store.update(|d| {
        if let Some(p) = d.exp_mut(&id).and_then(|e| e.places.iter_mut().find(|p| p.id == place_id)) {
            p.enabled = enabled;
        }
    });
}

#[tauri::command]
async fn exp_refresh(state: State<'_, AppState>, id: String) -> Res<()> {
    let store = state.store.clone();
    blocking(move || {
        let (uni, root) = store.lock().exp(&id).map(|e| (e.universe_id.clone(), e.root_place_id.clone())).ok_or("Experience not found.")?;
        let acct_user = store.lock().account.as_ref().and_then(|a| a.user_id.clone());
        let g = roblox::resolve_game(&uni, store.credential().ok().as_ref(), acct_user).map_err(|e| e.msg)?;
        let places = roblox::get_places(&uni, if g.root_place_id.is_empty() { &root } else { &g.root_place_id });
        let rating = roblox::get_rating(&uni);
        store.update(|d| {
            if let Some(e) = d.exp_mut(&id) {
                e.name = g.name.clone();
                e.playing = g.playing;
                e.rating = rating;
                let old = std::mem::take(&mut e.places);
                e.places = places.iter().map(|(pid, n)| Place { id: pid.clone(), name: n.clone(), enabled: old.iter().find(|o| &o.id == pid).map(|o| o.enabled).unwrap_or(true) }).collect();
            }
        });
        Ok(())
    })
    .await
}

#[tauri::command]
fn exp_set_plan(state: State<'_, AppState>, id: String, at: Option<i64>, announce_title: Option<String>, announce_body: Option<String>) {
    state.store.update(|d| {
        if let Some(e) = d.exp_mut(&id) {
            e.planned_at = at;
            if let Some(t) = announce_title {
                e.announce_title = t.chars().take(120).collect();
            }
            if let Some(b) = announce_body {
                e.announce_body = b.chars().take(2000).collect();
            }
        }
    });
}

/// Renders what a countdown step will look like ("new" = the new icon).
#[tauri::command]
async fn exp_preview(state: State<'_, AppState>, id: String, timer_id: String) -> Res<String> {
    let store = state.store.clone();
    blocking(move || {
        let (base, timer, new_icon) = {
            let d = store.lock();
            let e = d.exp(&id).ok_or("Experience not found.")?;
            (e.current_icon.clone(), e.timers.iter().find(|t| t.id == timer_id).cloned(), e.new_icon.clone())
        };
        if timer_id == "new" {
            let png = new_icon.and_then(|n| store.read_image(&n)).ok_or("Choose a new icon first.")?;
            return Ok(png_data_url(&png));
        }
        let t = timer.ok_or("Countdown step not found.")?;
        let b = base.and_then(|n| store.read_image(&n));
        let o = t.overlay.as_ref().and_then(|n| store.read_image(n));
        let img = images::composite(b.as_deref(), o.as_deref(), &t.label);
        Ok(png_data_url(&images::encode_png(&img)))
    })
    .await
}

/// Builds every countdown image and hands the update to the scheduler, which uploads
/// them early, waits for Roblox moderation, and switches icons when each step is due.
#[tauri::command]
async fn exp_start_update(state: State<'_, AppState>, id: String) -> Res<()> {
    let (store, sched) = (state.store.clone(), state.sched.clone());
    blocking(move || {
        let e = store.lock().exp(&id).cloned().ok_or("Experience not found.")?;
        let at = e.planned_at.ok_or("Pick an update time first.")?;
        let base_png = e.current_icon.as_ref().and_then(|n| store.read_image(n));
        let new_png = e.new_icon.as_ref().and_then(|n| store.read_image(n)).ok_or("Choose a new icon first.")?;
        let mut ts = e.timers.clone();
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
        sched.start_update(&id, at, steps, base_png)
    })
    .await
}

#[tauri::command]
fn exp_cancel_update(state: State<'_, AppState>, id: String) {
    state.sched.cancel_update(&id);
}

#[tauri::command]
fn exp_clear_finished(state: State<'_, AppState>, id: String) {
    state.store.update(|d| {
        if let Some(e) = d.exp_mut(&id) {
            if e.update.as_ref().is_some_and(|u| !u.status.active()) {
                e.update = None;
            }
        }
    });
}

// ------------------------------------------------------------------ phone relay

#[tauri::command]
fn relay_start(state: State<'_, AppState>) -> Res<Value> {
    let url = state.relay.start()?;
    Ok(json!({ "url": url, "qr": png_data_url(&relay::qr_png(&url)) }))
}

#[tauri::command]
fn relay_rotate(state: State<'_, AppState>) -> Res<Value> {
    let url = state.relay.rotate().ok_or("Start the phone relay first.")?;
    Ok(json!({ "url": url, "qr": png_data_url(&relay::qr_png(&url)) }))
}

pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        app_info,
        restart_for_update,
        open_external,
        desktop_notify,
        take_pending_link,
        reveal_data_dir,
        save_text_file,
        quit_app,
        secure_get,
        secure_set,
        secure_remove,
        secure_clear,
        engine_state,
        engine_set_settings,
        roblox_sign_in,
        roblox_cancel_sign_in,
        roblox_sign_out,
        roblox_set_api_key,
        roblox_clear_api_key,
        roblox_resolve,
        roblox_game_stats,
        exp_add,
        exp_remove,
        exp_link,
        exp_set_image,
        exp_fetch_current_icon,
        exp_set_timers,
        exp_set_overlay,
        exp_set_place,
        exp_refresh,
        exp_set_plan,
        exp_preview,
        exp_start_update,
        exp_cancel_update,
        exp_clear_finished,
        relay_start,
        relay_rotate,
    ]
}
