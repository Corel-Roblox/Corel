//! "Sign in with Roblox": OAuth 2.0 authorization code flow with PKCE.
//! The browser shows Roblox's own consent page (pick the accounts, press Select),
//! then redirects to a one-shot listener on localhost that receives the code.
//! Docs: https://create.roblox.com/docs/cloud/auth/oauth2-overview

use crate::store::{now_ms, Account, Granted, Store};
use base64::Engine;
use rand::Rng;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const PORT: u16 = 52817;
pub const SCOPES: &str = "openid profile asset:read asset:write";
const AUTHORIZE: &str = "https://apis.roblox.com/oauth/v1/authorize";
const TOKEN: &str = "https://apis.roblox.com/oauth/v1/token";
const USERINFO: &str = "https://apis.roblox.com/oauth/v1/userinfo";
const RESOURCES: &str = "https://apis.roblox.com/oauth/v1/token/resources";
const REVOKE: &str = "https://apis.roblox.com/oauth/v1/token/revoke";

pub fn redirect_uri() -> String {
    format!("http://localhost:{PORT}/callback")
}

/// Roicon's registered Roblox OAuth app. Client IDs are public; the secret is not
/// shipped (paste it in Settings, it is kept in Windows Credential Manager).
const DEFAULT_CLIENT_ID: &str = "5489589349817571995";

/// Client ID: set in Settings, else ROICON_CLIENT_ID at build time, else Roicon's own.
pub fn client_id(store: &Store) -> Option<String> {
    store.lock().oauth_client_id.clone().filter(|s| !s.trim().is_empty()).or_else(|| option_env!("ROICON_CLIENT_ID").map(str::to_owned)).or_else(|| Some(DEFAULT_CLIENT_ID.to_owned()))
}

/// Client secret built into this binary by build.rs (if one was available at build time).
pub fn embedded_secret() -> Option<String> {
    let (x, k) = (option_env!("ROICON_SECRET_X")?, option_env!("ROICON_SECRET_K")?);
    let hex = |s: &str| (0..s.len()).step_by(2).filter_map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok()).collect::<Vec<u8>>();
    String::from_utf8(hex(x).iter().zip(hex(k)).map(|(a, b)| a ^ b).collect()).ok()
}

fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder().user_agent("Roicon/1.0").timeout(Duration::from_secs(30)).build().expect("http")
}

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random_string(n: usize) -> String {
    const CH: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut r = rand::rng();
    (0..n).map(|_| CH[r.random_range(0..CH.len())] as char).collect()
}

pub struct TokenSet {
    pub access: String,
    pub refresh: String,
    pub expires_at: i64,
}

fn token_request(store: &Store, form: Vec<(&str, String)>) -> Result<TokenSet, String> {
    let cid = client_id(store).ok_or("Set up Sign in with Roblox first.")?;
    let mut form = form;
    form.push(("client_id", cid));
    if let Some(sec) = store.oauth_secret() {
        form.push(("client_secret", sec));
    }
    let res = client().post(TOKEN).form(&form).send().map_err(|e| format!("Couldn't reach Roblox: {e}"))?;
    let status = res.status();
    let v: Value = res.json().unwrap_or(Value::Null);
    if !status.is_success() {
        let e = v["error_description"].as_str().or(v["error"].as_str()).unwrap_or("unknown error");
        return Err(format!("Roblox sign-in failed ({}): {e}", status.as_u16()));
    }
    Ok(TokenSet {
        access: v["access_token"].as_str().unwrap_or_default().to_owned(),
        refresh: v["refresh_token"].as_str().unwrap_or_default().to_owned(),
        expires_at: now_ms() + v["expires_in"].as_i64().unwrap_or(900) * 1000,
    })
}

pub fn refresh(store: &Store, refresh_token: &str) -> Result<TokenSet, String> {
    token_request(store, vec![("grant_type", "refresh_token".into()), ("refresh_token", refresh_token.into())])
}

const DONE_PAGE: &str = r##"<!doctype html><meta charset="utf-8"><title>Roicon</title><style>body{margin:0;height:100vh;display:grid;place-items:center;background:#0b0b10;color:#ecebf5;font:15px "Segoe UI",system-ui,sans-serif;background:radial-gradient(600px 400px at 20% 0,rgba(109,93,252,.25),transparent 60%),#0b0b10}.c{text-align:center}.l{width:64px;height:64px;border-radius:17px;background:linear-gradient(145deg,#7d6dff,#5a4be8);display:grid;place-items:center;margin:0 auto 18px;box-shadow:0 10px 30px rgba(109,93,252,.45)}h1{font-size:24px;margin:0 0 6px}p{color:#8d8c9e;margin:0}</style><div class="c"><div class="l"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div><h1>TITLE</h1><p>BODY</p></div>"##;

fn page(title: &str, body: &str) -> String {
    DONE_PAGE.replace("TITLE", title).replace("BODY", body)
}

/// Runs the whole browser flow. Blocks until done, cancelled, or 5 minutes pass.
pub fn sign_in(store: &Store, cancel: Arc<AtomicBool>) -> Result<(), String> {
    let cid = client_id(store).ok_or("Set up Sign in with Roblox first.")?;
    let verifier = random_string(64);
    let challenge = b64(&Sha256::digest(verifier.as_bytes()));
    let state = random_string(24);
    let url = reqwest::Url::parse_with_params(
        AUTHORIZE,
        &[
            ("client_id", cid.as_str()),
            ("redirect_uri", redirect_uri().as_str()),
            ("scope", SCOPES),
            ("response_type", "code"),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("state", state.as_str()),
        ],
    )
    .map_err(|e| e.to_string())?;

    let v4 = tiny_http::Server::http(("127.0.0.1", PORT)).map_err(|_| format!("Port {PORT} is busy. Close other Roicon windows and try again."))?;
    let v6 = tiny_http::Server::http(("::1", PORT)).ok();
    crate::open_url(url.as_str());

    let start = Instant::now();
    let code = loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        if start.elapsed() > Duration::from_secs(300) {
            return Err("Sign-in timed out. Try again.".into());
        }
        let req = v4.recv_timeout(Duration::from_millis(250)).ok().flatten().or_else(|| v6.as_ref().and_then(|s| s.recv_timeout(Duration::from_millis(50)).ok().flatten()));
        let Some(req) = req else { continue };
        let u = req.url().to_owned();
        if !u.starts_with("/callback") {
            let _ = req.respond(tiny_http::Response::from_string("").with_status_code(404));
            continue;
        }
        let q = reqwest::Url::parse(&format!("http://localhost{u}")).map_err(|e| e.to_string())?;
        let get = |k: &str| q.query_pairs().find(|(a, _)| a == k).map(|(_, v)| v.into_owned());
        let html = |s: String| tiny_http::Response::from_string(s).with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap());
        if get("state").as_deref() != Some(state.as_str()) {
            let _ = req.respond(html(page("That link didn't match", "Go back to Roicon and press Connect again.")));
            continue;
        }
        if let Some(err) = get("error") {
            let _ = req.respond(html(page("Not connected", "You can close this tab and try again in Roicon.")));
            return Err(if err == "access_denied" { "You cancelled the Roblox sign-in.".into() } else { format!("Roblox sign-in failed: {}", get("error_description").unwrap_or(err)) });
        }
        let Some(code) = get("code") else { continue };
        let _ = req.respond(html(page("You're connected", "Roicon can now update your icons. You can close this tab.")));
        break code;
    };

    let tokens = token_request(store, vec![("grant_type", "authorization_code".into()), ("code", code), ("code_verifier", verifier), ("redirect_uri", redirect_uri())])?;
    store.set_oauth_tokens(Some(&tokens));
    load_profile(store, &tokens.access);
    crate::show_window();
    Ok(())
}

fn download(url: &str) -> Option<Vec<u8>> {
    client().get(url).send().ok().filter(|r| r.status().is_success()).and_then(|r| r.bytes().ok()).map(|b| b.to_vec())
}

fn thumb(url: &str) -> Option<String> {
    let v: Value = client().get(url).send().ok()?.json().ok()?;
    v["data"][0]["imageUrl"].as_str().map(str::to_owned)
}

/// Fills in the account (name, avatar, which accounts/groups were granted).
pub fn load_profile(store: &Store, access: &str) {
    let info: Value = client().get(USERINFO).bearer_auth(access).send().ok().and_then(|r| r.json().ok()).unwrap_or(Value::Null);
    let user_id = info["sub"].as_str().map(str::to_owned);
    let mut acct = Account {
        user_id: user_id.clone(),
        name: info["preferred_username"].as_str().map(str::to_owned),
        display_name: info["name"].as_str().or(info["nickname"].as_str()).map(str::to_owned),
        method: "oauth".into(),
        ..Default::default()
    };
    let pic = info["picture"].as_str().map(str::to_owned).or_else(|| user_id.as_ref().and_then(|id| thumb(&format!("https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds={id}&size=150x150&format=Png"))));
    acct.avatar = pic.and_then(|u| download(&u)).map(|b| store.put_image(&b));

    // Which owners (the user and/or groups) the user picked on the consent page.
    if let Some(cid) = client_id(store) {
        let mut form = vec![("token", access.to_owned()), ("client_id", cid)];
        if let Some(sec) = store.oauth_secret() {
            form.push(("client_secret", sec));
        }
        if let Ok(v) = client().post(RESOURCES).form(&form).send().and_then(|r| r.json::<Value>()) {
            for ri in v["resource_infos"].as_array().cloned().unwrap_or_default() {
                let kind = ri["owner"]["type"].as_str().unwrap_or("User").to_owned();
                let id = ri["owner"]["id"].as_str().map(str::to_owned).or(ri["owner"]["id"].as_u64().map(|x| x.to_string())).unwrap_or_default();
                if id.is_empty() || acct.granted.iter().any(|g| g.id == id) {
                    continue;
                }
                let (name, img) = if kind == "Group" {
                    let n = client().get(format!("https://groups.roblox.com/v1/groups/{id}")).send().ok().and_then(|r| r.json::<Value>().ok()).and_then(|v| v["name"].as_str().map(str::to_owned));
                    let i = thumb(&format!("https://thumbnails.roblox.com/v1/groups/icons?groupIds={id}&size=150x150&format=Png")).and_then(|u| download(&u)).map(|b| store.put_image(&b));
                    (n.unwrap_or_else(|| format!("Group {id}")), i)
                } else if Some(&id) == user_id.as_ref() {
                    (acct.name.clone().unwrap_or_default(), acct.avatar.clone())
                } else {
                    (format!("User {id}"), None)
                };
                acct.granted.push(Granted { kind, id, name, avatar: img });
            }
        }
    }
    if acct.granted.is_empty() {
        if let Some(id) = &user_id {
            acct.granted.push(Granted { kind: "User".into(), id: id.clone(), name: acct.name.clone().unwrap_or_default(), avatar: acct.avatar.clone() });
        }
    }
    store.update(|d| d.account = Some(acct));
}

pub fn sign_out(store: &Store) {
    if let (Some(rt), Some(cid)) = (store.oauth_refresh_token(), client_id(store)) {
        let mut form = vec![("token", rt), ("client_id", cid)];
        if let Some(sec) = store.oauth_secret() {
            form.push(("client_secret", sec));
        }
        let _ = client().post(REVOKE).form(&form).send();
    }
    store.set_oauth_tokens(None);
    store.update(|d| d.account = None);
}
