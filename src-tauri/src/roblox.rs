//! Roblox API client (blocking; always called from worker threads).
//!
//! Open Cloud, with the creator's API key (https://create.roblox.com/docs/cloud):
//!   POST  /assets/v1/assets                       upload an Image         (asset:write)
//!   GET   /assets/v1/operations/{id}              poll the upload         (asset:write)
//!   GET   /assets/v1/assets/{id}?readMask=...     moderation state        (asset:read)
//!   PATCH /assets/v1/assets/{placeId}?updateMask=icon   set a place's icon (asset:write)
//!   GET   /cloud/v2/universes/{id}                check key access
//! Public web APIs (no auth) for game names, places, ratings and the current icon.

use reqwest::blocking::{multipart, Client, RequestBuilder, Response};
use serde_json::{json, Value};
use std::thread::sleep;
use std::time::{Duration, Instant};

const OC: &str = "https://apis.roblox.com";

#[derive(Debug, Clone)]
pub struct RbxError {
    pub status: u16,
    pub msg: String,
}
impl std::fmt::Display for RbxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.msg)
    }
}
pub type R<T> = Result<T, RbxError>;

/// Auth header for Open Cloud: an OAuth bearer token or an API key.
#[derive(Clone)]
pub struct Cred {
    pub header: &'static str,
    pub value: String,
}
impl Cred {
    pub fn bearer(t: &str) -> Self {
        Cred { header: "Authorization", value: format!("Bearer {t}") }
    }
    pub fn api_key(k: &str) -> Self {
        Cred { header: "x-api-key", value: k.to_owned() }
    }
}

fn err(status: u16, msg: impl Into<String>) -> RbxError {
    RbxError { status, msg: msg.into() }
}

fn client() -> &'static Client {
    static C: std::sync::OnceLock<Client> = std::sync::OnceLock::new();
    C.get_or_init(|| Client::builder().user_agent("Corel/2.0").timeout(Duration::from_secs(60)).build().expect("http client"))
}

/// Sends with retries on network errors, 429 and 5xx. `make` rebuilds the request each attempt.
fn send(make: impl Fn() -> RequestBuilder, retries: u32) -> R<Response> {
    let mut delay = Duration::from_secs(1);
    let mut attempt = 0;
    loop {
        match make().send() {
            Ok(res) => {
                let st = res.status().as_u16();
                if (st == 429 || st >= 500) && attempt < retries {
                    let ra = res.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok());
                    sleep(ra.map(Duration::from_secs).unwrap_or(delay));
                } else if res.status().is_success() {
                    return Ok(res);
                } else {
                    let text = res.text().unwrap_or_default();
                    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                    let m = v["message"].as_str().or(v["errors"][0]["message"].as_str()).or(v["errorMessage"].as_str()).map(str::to_owned).unwrap_or(text);
                    return Err(err(st, match st {
                        401 => format!("Roblox rejected the sign-in (401). Reconnect your account. {m}"),
                        403 => format!("No permission for this (403). Reconnect and select the account or group that owns the game. {m}"),
                        _ => format!("Roblox returned {st}: {m}"),
                    }));
                }
            }
            Err(e) if attempt < retries => {
                let _ = e;
                sleep(delay);
            }
            Err(e) => return Err(err(0, format!("Network error: {e}"))),
        }
        attempt += 1;
        delay *= 2;
    }
}

fn get_json(url: &str, cred: Option<&Cred>) -> R<Value> {
    let res = send(|| {
        let r = client().get(url);
        match cred { Some(c) => r.header(c.header, &c.value), None => r }
    }, 4)?;
    res.json().map_err(|e| err(0, format!("Bad response from Roblox: {e}")))
}

// ---------------- public lookups ----------------

#[derive(Debug, Clone)]
pub struct GameInfo {
    pub universe_id: String,
    pub root_place_id: String,
    pub name: String,
    pub creator_kind: String,
    pub creator_id: String,
    pub creator_name: String,
    pub playing: u64,
}

pub fn get_game(universe_id: &str) -> R<GameInfo> {
    let j = get_json(&format!("https://games.roblox.com/v1/games?universeIds={universe_id}"), None)?;
    let g = &j["data"][0];
    if g.is_null() {
        return Err(err(404, format!("No experience found with universe ID {universe_id}.")));
    }
    // Private or not-yet-rated games come back as a placeholder with ID 0.
    if g["id"].as_u64().unwrap_or(0) == 0 {
        return Err(err(451, "Roblox hides this experience's details publicly."));
    }
    Ok(GameInfo {
        universe_id: g["id"].as_u64().map(|v| v.to_string()).unwrap_or_default(),
        root_place_id: g["rootPlaceId"].as_u64().map(|v| v.to_string()).unwrap_or_default(),
        name: g["name"].as_str().unwrap_or("Untitled").to_owned(),
        creator_kind: g["creator"]["type"].as_str().unwrap_or("User").to_owned(),
        creator_id: g["creator"]["id"].as_u64().map(|v| v.to_string()).unwrap_or_default(),
        creator_name: g["creator"]["name"].as_str().unwrap_or("").to_owned(),
        playing: g["playing"].as_u64().unwrap_or(0),
    })
}

pub fn get_rating(universe_id: &str) -> Option<u32> {
    let j = get_json(&format!("https://games.roblox.com/v1/games/votes?universeIds={universe_id}"), None).ok()?;
    let up = j["data"][0]["upVotes"].as_f64()?;
    let down = j["data"][0]["downVotes"].as_f64()?;
    (up + down > 0.0).then(|| (up / (up + down) * 100.0).round() as u32)
}

pub fn get_places(universe_id: &str, root_place_id: &str) -> Vec<(String, String)> {
    let mut out = vec![];
    let mut cursor = String::new();
    loop {
        let url = format!("https://develop.roblox.com/v1/universes/{universe_id}/places?sortOrder=Asc&limit=100{}", if cursor.is_empty() { String::new() } else { format!("&cursor={cursor}") });
        let Ok(j) = get_json(&url, None) else { break };
        for p in j["data"].as_array().cloned().unwrap_or_default() {
            if let (Some(id), Some(name)) = (p["id"].as_u64(), p["name"].as_str()) {
                out.push((id.to_string(), name.to_owned()));
            }
        }
        match j["nextPageCursor"].as_str() {
            Some(c) if !c.is_empty() => cursor = c.to_owned(),
            _ => break,
        }
    }
    if out.is_empty() && !root_place_id.is_empty() {
        out.push((root_place_id.to_owned(), "Main".to_owned()));
    }
    out
}

/// Accepts a universe ID, a place ID, or a roblox.com/games/<placeId>/... link.
pub fn universe_from_input(input: &str) -> R<String> {
    let s = input.trim();
    let place_to_universe = |pid: &str| -> R<String> {
        let j = get_json(&format!("{OC}/universes/v1/places/{pid}/universe"), None)?;
        j["universeId"].as_u64().map(|v| v.to_string()).ok_or_else(|| err(404, format!("Nothing found for {pid}.")))
    };
    if let Some(i) = s.to_lowercase().find("roblox.com/games/") {
        let rest = &s[i + "roblox.com/games/".len()..];
        let pid: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if !pid.is_empty() {
            return place_to_universe(&pid);
        }
    }
    if s.is_empty() || !s.chars().all(|c| c.is_ascii_digit()) {
        return Err(err(400, "Enter a universe ID, a place ID or a roblox.com/games link."));
    }
    // A bare number is most often the place ID from the game's URL, so try that first.
    if let Ok(u) = place_to_universe(s) {
        return Ok(u);
    }
    get_game(s).map(|_| s.to_owned()).map_err(|_| err(404, format!("No game found for {s}. Paste the game's link or its place ID.")))
}

pub fn get_game_icon_png(universe_id: &str) -> R<Vec<u8>> {
    let j = get_json(&format!("https://thumbnails.roblox.com/v1/games/icons?universeIds={universe_id}&size=512x512&format=Png&isCircular=false&returnPolicy=PlaceHolder"), None)?;
    let url = j["data"]
        .as_array()
        .and_then(|a| a.iter().find(|d| d["targetId"].as_u64().map(|v| v.to_string()).as_deref() == Some(universe_id)))
        .and_then(|d| d["imageUrl"].as_str())
        .ok_or_else(|| err(404, "Roblox has no icon for this experience yet."))?
        .to_owned();
    let res = send(|| client().get(&url), 3)?;
    res.bytes().map(|b| b.to_vec()).map_err(|e| err(0, e.to_string()))
}

pub struct User {
    pub id: String,
    pub name: String,
    pub display_name: String,
}

pub fn get_user(user_id: &str) -> R<User> {
    let u = get_json(&format!("https://users.roblox.com/v1/users/{user_id}"), None)?;
    Ok(User {
        id: user_id.to_owned(),
        name: u["name"].as_str().unwrap_or("").to_owned(),
        display_name: u["displayName"].as_str().unwrap_or("").to_owned(),
    })
}

// ---------------- Open Cloud ----------------

pub fn introspect_key(key: &str) -> R<Value> {
    let body = json!({ "apiKey": key }).to_string();
    let res = send(|| client().post(format!("{OC}/api-keys/v1/introspect")).header("Content-Type", "application/json").body(body.clone()), 2)?;
    res.json().map_err(|e| err(0, e.to_string()))
}

/// Universe details through Open Cloud (works for private games you have access to):
/// (display name, root place ID, (owner kind "User"/"Group", owner ID)).
pub fn universe_details(cred: &Cred, universe_id: &str) -> R<(Option<String>, Option<String>, Option<(String, String)>)> {
    let v = get_json(&format!("{OC}/cloud/v2/universes/{universe_id}"), Some(cred))?;
    let name = v["displayName"].as_str().map(str::to_owned);
    let root = v["rootPlace"].as_str().and_then(|p| p.rsplit('/').next()).map(str::to_owned);
    let owner = v["user"].as_str().and_then(|u| u.rsplit('/').next()).map(|id| ("User".to_owned(), id.to_owned()))
        .or_else(|| v["group"].as_str().and_then(|g| g.rsplit('/').next()).map(|id| ("Group".to_owned(), id.to_owned())));
    Ok((name, root, owner))
}

/// Game info that also works for games Roblox hides publicly: falls back to Open Cloud
/// (with your sign-in), the place list, and finally the signed-in user as owner.
pub fn resolve_game(universe_id: &str, cred: Option<&Cred>, account_user: Option<String>) -> R<GameInfo> {
    match get_game(universe_id) {
        Ok(g) => return Ok(g),
        Err(e) if e.status != 451 => return Err(e),
        Err(_) if cred.is_none() => {
            return Err(err(451, "Roblox hides this game publicly (for example, it's 16+ or private). Connect your Roblox account first, then add it."));
        }
        Err(_) => {}
    }
    let mut g = GameInfo { universe_id: universe_id.to_owned(), root_place_id: String::new(), name: String::new(), creator_kind: "User".into(), creator_id: String::new(), creator_name: String::new(), playing: 0 };
    if let Some(c) = cred {
        if let Ok((name, root, owner)) = universe_details(c, universe_id) {
            g.name = name.unwrap_or_default();
            g.root_place_id = root.unwrap_or_default();
            if let Some((k, id)) = owner {
                g.creator_kind = k;
                g.creator_id = id;
            }
        }
    }
    let places = get_places(universe_id, &g.root_place_id);
    if g.root_place_id.is_empty() {
        g.root_place_id = places.first().map(|p| p.0.clone()).unwrap_or_default();
    }
    if g.name.is_empty() {
        g.name = places.iter().find(|p| p.0 == g.root_place_id).or(places.first()).map(|p| p.1.clone()).unwrap_or_else(|| format!("Experience {universe_id}"));
    }
    if g.creator_id.is_empty() {
        if let Some(u) = account_user {
            g.creator_id = u;
        }
    }
    Ok(g)
}

pub fn check_universe_access(cred: &Cred, universe_id: &str) -> R<()> {
    get_json(&format!("{OC}/cloud/v2/universes/{universe_id}"), Some(cred)).map(|_| ())
}

fn json_part(v: &Value) -> multipart::Part {
    multipart::Part::text(v.to_string()).mime_str("application/json").expect("mime")
}

/// Uploads a PNG as an Image asset and waits for the upload operation. Returns (assetId, moderationState).
pub fn upload_image(cred: &Cred, png: &[u8], name: &str, description: &str, creator_kind: &str, creator_id: &str) -> R<(String, String)> {
    let creator = if creator_kind == "Group" { json!({ "groupId": creator_id }) } else { json!({ "userId": creator_id }) };
    let meta = json!({
        "assetType": "Image",
        "displayName": name.chars().take(50).collect::<String>(),
        "description": description.chars().take(1000).collect::<String>(),
        // Place icons must use Open Use images.
        "creationContext": { "creator": creator, "assetPrivacy": "OpenUse" },
    });
    let png = png.to_vec();
    let res = send(|| {
        let form = multipart::Form::new()
            .part("request", json_part(&meta))
            .part("fileContent", multipart::Part::bytes(png.clone()).file_name("icon.png").mime_str("image/png").expect("mime"));
        client().post(format!("{OC}/assets/v1/assets")).header(cred.header, &cred.value).multipart(form)
    }, 2)?;
    let mut op: Value = res.json().map_err(|e| err(0, e.to_string()))?;
    let op_id = op["operationId"].as_str().map(str::to_owned).or_else(|| op["path"].as_str().and_then(|p| p.rsplit('/').next()).map(str::to_owned)).unwrap_or_default();

    let start = Instant::now();
    let mut delay = Duration::from_millis(1500);
    while !op["done"].as_bool().unwrap_or(false) {
        if start.elapsed() > Duration::from_secs(180) {
            return Err(err(0, "The upload is taking too long; it will be retried."));
        }
        sleep(delay);
        delay = (delay * 3 / 2).min(Duration::from_secs(8));
        op = get_json(&format!("{OC}/assets/v1/operations/{op_id}"), Some(cred))?;
    }
    if !op["error"].is_null() {
        return Err(err(0, format!("Upload failed: {}", op["error"]["message"].as_str().unwrap_or(&op["error"].to_string()))));
    }
    let r = &op["response"];
    let asset_id = r["assetId"].as_str().map(str::to_owned).or_else(|| r["assetId"].as_u64().map(|v| v.to_string())).ok_or_else(|| err(0, "Roblox did not return an asset ID."))?;
    let state = r["moderationResult"]["moderationState"].as_str().unwrap_or("Reviewing").to_owned();
    Ok((asset_id, state))
}

pub fn moderation_state(cred: &Cred, asset_id: &str) -> R<String> {
    let a = get_json(&format!("{OC}/assets/v1/assets/{asset_id}?readMask=moderationResult"), Some(cred))?;
    Ok(a["moderationResult"]["moderationState"].as_str().unwrap_or("Unspecified").to_owned())
}

pub fn set_place_icon(cred: &Cred, place_id: &str, image_asset_id: &str) -> R<()> {
    let meta = json!({ "assetId": place_id, "icon": format!("assets/{image_asset_id}") });
    send(|| {
        let form = multipart::Form::new().part("request", json_part(&meta));
        client().patch(format!("{OC}/assets/v1/assets/{place_id}?updateMask=icon")).header(cred.header, &cred.value).multipart(form)
    }, 3)
    .map(|_| ())
}

// ---------------- stats (public web APIs) ----------------

/// Public numbers Roblox shows on an experience page. `None` means Roblox did not
/// return the value (private or hidden experience), which is not the same as zero.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStats {
    pub universe_id: String,
    pub name: Option<String>,
    pub visits: Option<u64>,
    pub playing: Option<u64>,
    pub favorites: Option<u64>,
    pub up_votes: Option<u64>,
    pub down_votes: Option<u64>,
    pub updated: Option<String>,
    pub max_players: Option<u64>,
}

/// Up to 50 universes per call (games API limit; larger lists are chunked).
pub fn get_game_stats(universe_ids: &[String]) -> R<Vec<GameStats>> {
    let mut out = vec![];
    for chunk in universe_ids.chunks(50) {
        let ids = chunk.join(",");
        let games = get_json(&format!("https://games.roblox.com/v1/games?universeIds={ids}"), None)?;
        let votes = get_json(&format!("https://games.roblox.com/v1/games/votes?universeIds={ids}"), None).unwrap_or(Value::Null);
        for id in chunk {
            let g = games["data"].as_array().and_then(|a| a.iter().find(|g| g["id"].as_u64().map(|v| v.to_string()).as_deref() == Some(id.as_str())));
            let v = votes["data"].as_array().and_then(|a| a.iter().find(|g| g["id"].as_u64().map(|v| v.to_string()).as_deref() == Some(id.as_str())));
            out.push(GameStats {
                universe_id: id.clone(),
                name: g.and_then(|g| g["name"].as_str()).map(str::to_owned),
                visits: g.and_then(|g| g["visits"].as_u64()),
                playing: g.and_then(|g| g["playing"].as_u64()),
                favorites: g.and_then(|g| g["favoritedCount"].as_u64()),
                up_votes: v.and_then(|v| v["upVotes"].as_u64()),
                down_votes: v.and_then(|v| v["downVotes"].as_u64()),
                updated: g.and_then(|g| g["updated"].as_str()).map(str::to_owned),
                max_players: g.and_then(|g| g["maxPlayers"].as_u64()),
            });
        }
    }
    Ok(out)
}

/// Public CDN URL of an experience's icon (512x512).
pub fn get_game_icon_url(universe_id: &str) -> R<String> {
    let j = get_json(&format!("https://thumbnails.roblox.com/v1/games/icons?universeIds={universe_id}&size=512x512&format=Png&isCircular=false&returnPolicy=PlaceHolder"), None)?;
    j["data"][0]["imageUrl"].as_str().map(str::to_owned).ok_or_else(|| err(404, "Roblox has no icon for this experience yet."))
}
