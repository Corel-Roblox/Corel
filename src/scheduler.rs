//! Runs scheduled icon updates on a background thread: every step's image is
//! uploaded early, Roblox moderation is polled until it is approved, and each
//! place's icon is switched when the step is due.

use crate::roblox;
use crate::store::*;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const MOD_POLL_MS: i64 = 20_000;

pub struct StepInput {
    pub key: String,
    pub label: String,
    pub at: i64,
    pub png: Vec<u8>,
}

#[derive(Clone)]
pub struct Scheduler {
    store: Store,
    busy: Arc<Mutex<HashSet<String>>>,
}

impl Scheduler {
    pub fn new(store: Store) -> Self {
        Self { store, busy: Default::default() }
    }

    pub fn spawn(&self) {
        let me = self.clone();
        std::thread::spawn(move || loop {
            me.tick();
            std::thread::sleep(Duration::from_secs(3));
        });
    }

    pub fn start_update(&self, exp_id: &str, at: i64, steps: Vec<StepInput>, restore_png: Option<Vec<u8>>) -> Result<(), String> {
        if !self.store.has_credential() {
            return Err("Connect your Roblox account first (Settings, bottom left).".into());
        }
        let now = now_ms();
        if at <= now {
            return Err("The update time has to be in the future.".into());
        }
        let mut all: Vec<Step> = steps.into_iter().map(|s| new_step(&self.store, s.key, s.label, Some(s.at), &s.png, false)).collect();
        let past: Vec<usize> = all.iter().enumerate().filter(|(_, s)| s.at.unwrap_or(0) <= now).map(|(i, _)| i).collect();
        if past.len() > 1 {
            for &i in &past[..past.len() - 1] {
                let s = &mut all[i];
                s.apply = Apply::Skipped;
                s.upload = Upload::Skipped;
                s.moderation = "skipped".into();
            }
        }
        if let Some(png) = restore_png {
            let mut r = new_step(&self.store, "restore".into(), "Original icon".into(), None, &png, true);
            r.apply = Apply::Standby;
            all.push(r);
        }
        self.store.update(|d| {
            let e = d.exp_mut(exp_id).ok_or("Experience not found.")?;
            if e.active_update().is_some() {
                return Err("An update is already running for this experience.".to_string());
            }
            let places: Vec<&Place> = e.enabled_places();
            if places.is_empty() {
                return Err("Turn on at least one place in the Settings tab.".into());
            }
            e.update = Some(Update {
                id: uid(),
                at,
                started_at: now,
                place_ids: places.iter().map(|p| p.id.clone()).collect(),
                place_names: places.iter().map(|p| p.name.clone()).collect(),
                status: Status::Preparing,
                steps: all,
                log: vec![],
                finished_at: None,
            });
            Ok(())
        })?;
        let me = self.clone();
        std::thread::spawn(move || me.tick());
        Ok(())
    }

    pub fn cancel_update(&self, exp_id: &str) {
        self.store.update(|d| {
            let Some(e) = d.exp_mut(exp_id) else { return };
            let Some(u) = e.update.as_mut() else { return };
            if !u.status.active() {
                return;
            }
            let shown = u.visible().any(|s| matches!(s.apply, Apply::Live | Apply::Done));
            let restore = u.steps.iter_mut().find(|s| s.key == "restore");
            match restore {
                Some(r) if shown && r.moderation != "Rejected" => {
                    r.apply = Apply::Upcoming;
                    r.at = Some(now_ms());
                    u.status = Status::Restoring;
                }
                _ => finish(e, Status::Cancelled),
            }
        });
    }

    fn run(&self, id: String, f: impl FnOnce(&Scheduler) + Send + 'static) {
        if !self.busy.lock().unwrap().insert(id.clone()) {
            return;
        }
        let me = self.clone();
        std::thread::spawn(move || {
            f(&me);
            me.busy.lock().unwrap().remove(&id);
        });
    }

    pub fn tick(&self) {
        if !self.store.has_credential() {
            return;
        }
        let key = String::new();
        let now = now_ms();
        let snapshot: Vec<Experience> = self.store.lock().experiences.iter().filter(|e| e.active_update().is_some()).cloned().collect();

        for e in snapshot {
            let u = e.update.as_ref().unwrap();
            // 1) uploads, one at a time per experience, in order
            if let Some(s) = u.steps.iter().find(|s| s.upload == Upload::Pending || (s.upload == Upload::Error && now >= s.retry_at)) {
                let (eid, sid, k) = (e.id.clone(), s.id.clone(), key.clone());
                self.run(format!("up:{}", e.id), move |me| me.upload(&eid, &sid, &k));
            }
            // 2) moderation polling
            for s in &u.steps {
                if s.asset_id.is_some() && !matches!(s.moderation.as_str(), "Approved" | "Rejected" | "skipped") && now - s.mod_checked_at > MOD_POLL_MS {
                    let (eid, sid, k) = (e.id.clone(), s.id.clone(), key.clone());
                    self.run(format!("mod:{sid}"), move |me| me.check_moderation(&eid, &sid, &k));
                }
            }
            if u.status == Status::Preparing && u.steps.iter().all(|s| matches!(s.upload, Upload::Done | Upload::Skipped)) {
                self.store.update(|d| set_status(d, &e.id, Status::Scheduled));
            }
            // 3) apply what is due
            if u.status == Status::Restoring {
                if let Some(r) = u.steps.iter().find(|s| s.key == "restore") {
                    if r.moderation == "Approved" {
                        let (eid, sid, k) = (e.id.clone(), r.id.clone(), key.clone());
                        self.run(format!("apply:{sid}"), move |me| me.apply(&eid, &sid, &k));
                    } else if r.moderation == "Rejected" {
                        self.store.update(|d| if let Some(e) = d.exp_mut(&e.id) { finish(e, Status::Cancelled) });
                    }
                }
                continue;
            }
            let due: Vec<&Step> = u.visible().filter(|s| s.at.unwrap_or(i64::MAX) <= now && !matches!(s.apply, Apply::Skipped | Apply::Done | Apply::Live)).collect();
            let Some(target) = due.last() else { continue };
            let superseded: Vec<String> = due[..due.len() - 1].iter().map(|s| s.id.clone()).collect();
            let (tid, tmod, tapply) = (target.id.clone(), target.moderation.clone(), target.apply);
            if !superseded.is_empty() {
                self.store.update(|d| {
                    if let Some(u) = d.exp_mut(&e.id).and_then(|e| e.update.as_mut()) {
                        for s in u.steps.iter_mut().filter(|s| superseded.contains(&s.id)) {
                            s.apply = Apply::Skipped;
                        }
                        log(u, "Earlier steps skipped because a later one is already due.");
                    }
                });
            }
            match tmod.as_str() {
                "Approved" => {
                    let (eid, k) = (e.id.clone(), key.clone());
                    self.run(format!("apply:{tid}"), move |me| me.apply(&eid, &tid, &k));
                }
                "Rejected" if tapply != Apply::Error => self.with_step(&e.id, &tid, |_, s| {
                    s.apply = Apply::Error;
                    s.error = Some("Roblox rejected this image in moderation.".into());
                }),
                "Rejected" => {}
                _ if tapply != Apply::Waiting => self.with_step(&e.id, &tid, |u, s| {
                    s.apply = Apply::Waiting;
                    u.push(format!("{} is due but still waiting for Roblox approval.", s.label));
                }),
                _ => {}
            }
        }
    }

    fn with_step(&self, eid: &str, sid: &str, f: impl FnOnce(&mut LogSink, &mut Step)) {
        self.store.update(|d| {
            if let Some(u) = d.exp_mut(eid).and_then(|e| e.update.as_mut()) {
                let mut sink = LogSink(vec![]);
                if let Some(s) = u.steps.iter_mut().find(|s| s.id == sid) {
                    f(&mut sink, s);
                }
                for m in sink.0 {
                    log(u, &m);
                }
            }
        });
    }

    fn upload(&self, eid: &str, sid: &str, _key: &str) {
        let cred = match self.store.credential() {
            Ok(c) => c,
            Err(e) => {
                self.with_step(eid, sid, |_, s| s.error = Some(e));
                return;
            }
        };
        let info = {
            let d = self.store.lock();
            d.exp(eid).and_then(|e| {
                let s = e.update.as_ref()?.steps.iter().find(|s| s.id == sid)?;
                Some((e.name.clone(), e.creator.clone(), s.label.clone(), s.image.clone()))
            })
        };
        let Some((name, mut creator, label, image)) = info else { return };
        if creator.id.is_empty() || creator.id == "0" {
            let uni = self.store.lock().exp(eid).map(|e| e.universe_id.clone()).unwrap_or_default();
            let found = roblox::universe_details(&cred, &uni).ok().and_then(|(_, _, o)| o).or_else(|| self.store.lock().account.as_ref().and_then(|a| a.user_id.clone()).map(|u| ("User".to_owned(), u)));
            if let Some((k, id)) = found {
                creator.kind = k;
                creator.id = id;
                let c = creator.clone();
                self.store.update(|d| if let Some(e) = d.exp_mut(eid) { e.creator = c });
            }
        }
        self.with_step(eid, sid, |_, s| {
            s.upload = Upload::Uploading;
            s.error = None;
        });
        let png = self.store.read_image(&image).unwrap_or_default();
        let display: String = format!("{name} {label}").chars().filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-').collect();
        let res = roblox::upload_image(&cred, &png, display.trim(), &format!("Roicon: {label} for {name}"), &creator.kind, &creator.id);
        self.with_step(eid, sid, |u, s| match res {
            Ok((asset, state)) => {
                s.asset_id = Some(asset.clone());
                s.upload = Upload::Done;
                s.moderation = state;
                s.mod_checked_at = now_ms();
                u.push(format!("{label} uploaded (asset {asset})."));
            }
            Err(e) => {
                s.upload = Upload::Error;
                s.error = Some(e.msg.clone());
                s.tries += 1;
                s.retry_at = now_ms() + (30_000 * s.tries as i64).min(300_000);
                u.push(format!("{label} upload failed: {}", e.msg));
            }
        });
    }

    fn check_moderation(&self, eid: &str, sid: &str, _key: &str) {
        let cred = match self.store.credential() {
            Ok(c) => c,
            Err(e) => {
                self.with_step(eid, sid, |_, s| s.error = Some(e));
                return;
            }
        };
        let asset = {
            let d = self.store.lock();
            d.exp(eid).and_then(|e| e.update.as_ref()?.steps.iter().find(|s| s.id == sid)?.asset_id.clone())
        };
        let Some(asset) = asset else { return };
        let res = roblox::moderation_state(&cred, &asset);
        self.with_step(eid, sid, |u, s| {
            s.mod_checked_at = now_ms();
            match res {
                Ok(state) if state != s.moderation => {
                    if state == "Approved" {
                        u.push(format!("{} approved by Roblox.", s.label));
                    } else if state == "Rejected" {
                        u.push(format!("{} was rejected by Roblox moderation.", s.label));
                    }
                    s.moderation = state;
                }
                Ok(_) => {}
                Err(e) => s.error = Some(e.msg),
            }
        });
    }

    fn apply(&self, eid: &str, sid: &str, _key: &str) {
        let cred = match self.store.credential() {
            Ok(c) => c,
            Err(e) => {
                self.with_step(eid, sid, |_, s| s.error = Some(e));
                return;
            }
        };
        let info = {
            let d = self.store.lock();
            d.exp(eid).and_then(|e| {
                let u = e.update.as_ref()?;
                let s = u.steps.iter().find(|s| s.id == sid)?;
                Some((u.place_ids.clone(), s.places_done.clone(), s.asset_id.clone()?))
            })
        };
        let Some((places, done_before, asset)) = info else { return };
        let mut done = done_before;
        let mut errors = vec![];
        for pid in places.iter().filter(|p| !done.contains(p)).cloned().collect::<Vec<_>>() {
            match roblox::set_place_icon(&cred, &pid, &asset) {
                Ok(()) => done.push(pid),
                Err(e) => errors.push(format!("{pid}: {}", e.msg)),
            }
        }
        let mut note: Option<(String, String)> = None;
        self.store.update(|d| {
            let notify_on = d.settings.notifications;
            let Some(e) = d.exp_mut(eid) else { return };
            let name = e.name.clone();
            let Some(u) = e.update.as_mut() else { return };
            let n = done.len();
            let last_visible = u.visible().last().map(|s| s.id.clone());
            let Some(idx) = u.steps.iter().position(|s| s.id == sid) else { return };
            u.steps[idx].places_done = done.clone();
            if !errors.is_empty() {
                u.steps[idx].apply = Apply::Retrying;
                u.steps[idx].error = Some(errors.join(" · "));
                let m = format!("{}: {} place(s) failed, retrying.", u.steps[idx].label, errors.len());
                log(u, &m);
                return;
            }
            u.steps[idx].error = None;
            u.steps[idx].applied_at = Some(now_ms());
            for s in u.steps.iter_mut() {
                if s.id != sid && s.apply == Apply::Live {
                    s.apply = Apply::Done;
                }
            }
            let label = u.steps[idx].label.clone();
            if u.steps[idx].key == "restore" {
                u.steps[idx].apply = Apply::Done;
                log(u, &format!("Original icon restored on {n} place(s)."));
                note = Some((name, format!("Update cancelled. Original icon restored on {n} place(s).")));
                finish(e, Status::Cancelled);
            } else if last_visible.as_deref() == Some(sid) {
                u.steps[idx].apply = Apply::Done;
                log(u, &format!("New icon applied on {n} place(s)."));
                note = Some((name, format!("New icon applied on {n} place(s).")));
                finish(e, Status::Done);
            } else {
                u.steps[idx].apply = Apply::Live;
                log(u, &format!("{label} icon is live on {n} place(s)."));
                note = Some((name, format!("{label} countdown icon is live on {n} place(s).")));
            }
            if !notify_on {
                note = None;
            }
        });
        if let Some((title, body)) = note {
            crate::notify(&title, &body);
        }
    }
}

/// Collects log lines while a step is mutably borrowed.
pub struct LogSink(Vec<String>);
impl LogSink {
    fn push(&mut self, m: String) {
        self.0.push(m);
    }
}

fn new_step(store: &Store, key: String, label: String, at: Option<i64>, png: &[u8], hidden: bool) -> Step {
    Step {
        id: uid(),
        key,
        label,
        at,
        hidden,
        image: store.put_image(png),
        asset_id: None,
        upload: Upload::Pending,
        moderation: "pending".into(),
        apply: Apply::Upcoming,
        places_done: vec![],
        error: None,
        tries: 0,
        retry_at: 0,
        mod_checked_at: 0,
        applied_at: None,
    }
}

fn set_status(d: &mut Data, eid: &str, st: Status) {
    if let Some(u) = d.exp_mut(eid).and_then(|e| e.update.as_mut()) {
        if u.status.active() {
            u.status = st;
        }
    }
}

fn log(u: &mut Update, msg: &str) {
    u.log.insert(0, LogItem { t: now_ms(), msg: msg.to_owned() });
    u.log.truncate(50);
}

pub fn finish(e: &mut Experience, status: Status) {
    let Some(u) = e.update.as_mut() else { return };
    u.status = status;
    let t = now_ms();
    u.finished_at = Some(t);
    let item = HistoryItem { id: u.id.clone(), at: u.at, status, finished_at: t };
    if status == Status::Done {
        if let Some(last) = u.visible().last() {
            e.current_icon = Some(last.image.clone());
        }
        e.new_icon = None;
        e.planned_at = None;
    }
    e.history.insert(0, item);
    e.history.truncate(20);
}
