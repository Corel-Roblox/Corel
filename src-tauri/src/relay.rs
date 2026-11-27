//! Phone relay: a tiny HTTP server on the local network. Scanning the QR code
//! in "Send to phone" opens a live countdown page on the phone.

use crate::store::*;
use serde_json::json;
use std::sync::{Arc, Mutex};

pub struct Relay {
    store: Store,
    port: Arc<Mutex<Option<u16>>>,
}

impl Relay {
    pub fn new(store: Store) -> Self {
        Self { store, port: Default::default() }
    }

    pub fn url(&self) -> Option<String> {
        let port = (*self.port.lock().unwrap())?;
        Some(format!("http://{}:{port}/relay?t={}", lan_ip(), self.store.lock().relay_token))
    }

    pub fn start(&self) -> Result<String, String> {
        if let Some(u) = self.url() {
            return Ok(u);
        }
        let mut server = None;
        for p in 47823..47843u16 {
            if let Ok(s) = tiny_http::Server::http(("0.0.0.0", p)) {
                server = Some((s, p));
                break;
            }
        }
        let (server, port) = server.ok_or("Could not open a local network port for the phone relay.")?;
        *self.port.lock().unwrap() = Some(port);
        let store = self.store.clone();
        std::thread::spawn(move || {
            for req in server.incoming_requests() {
                handle(&store, req);
            }
        });
        self.url().ok_or_else(|| "Relay failed to start.".into())
    }

    pub fn rotate(&self) -> Option<String> {
        self.store.update(|d| d.relay_token = random_token());
        self.url()
    }
}

fn header(k: &str, v: &str) -> tiny_http::Header {
    tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap()
}

fn handle(store: &Store, req: tiny_http::Request) {
    let url = req.url().to_owned();
    let (path, query) = url.split_once('?').unwrap_or((&url, ""));
    let param = |k: &str| query.split('&').filter_map(|kv| kv.split_once('=')).find(|(a, _)| *a == k).map(|(_, v)| v.to_owned());
    let token_ok = param("t").as_deref() == Some(store.lock().relay_token.as_str());
    let respond = |req: tiny_http::Request, code: u16, ctype: &str, body: Vec<u8>| {
        let r = tiny_http::Response::from_data(body).with_status_code(code).with_header(header("Content-Type", ctype)).with_header(header("Cache-Control", "no-store"));
        let _ = req.respond(r);
    };
    if !token_ok {
        return respond(req, 403, "text/plain", b"This link has expired. Scan the code in Corel again.".to_vec());
    }
    match path {
        "/relay" => respond(req, 200, "text/html; charset=utf-8", PHONE_HTML.as_bytes().to_vec()),
        "/api/state" => {
            let d = store.lock();
            let exps: Vec<_> = d
                .experiences
                .iter()
                .map(|e| {
                    json!({
                        "name": e.name,
                        "icon": e.current_icon,
                        "places": e.enabled_places().len(),
                        "update": e.update.as_ref().map(|u| json!({
                            "at": u.at,
                            "status": u.status,
                            "placeNames": u.place_names,
                            "steps": u.visible().map(|s| json!({ "label": s.label, "at": s.at, "image": s.image, "upload": s.upload, "moderation": s.moderation, "apply": s.apply })).collect::<Vec<_>>(),
                        })),
                    })
                })
                .collect();
            let acct = d.account.as_ref().map(|a| json!({ "name": a.display_name.clone().or(a.name.clone()).or(a.key_name.clone()), "handle": a.name }));
            let body = json!({ "account": acct, "experiences": exps, "now": now_ms(), "use24h": d.settings.use_24h }).to_string();
            drop(d);
            respond(req, 200, "application/json", body.into_bytes())
        }
        "/img" => match param("n").and_then(|n| store.read_image(&n)) {
            Some(b) => respond(req, 200, "image/png", b),
            None => respond(req, 404, "text/plain", b"not found".to_vec()),
        },
        _ => respond(req, 404, "text/plain", b"not found".to_vec()),
    }
}

/// Best-guess LAN IPv4 (the address the phone can reach), via a UDP "connect" (no packets sent).
pub fn lan_ip() -> String {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("192.168.1.1:9")?;
            s.local_addr()
        })
        .map(|a| a.ip().to_string())
        .ok()
        .filter(|ip| ip != "0.0.0.0")
        .unwrap_or_else(|| "127.0.0.1".into())
}

pub fn qr_png(text: &str) -> Vec<u8> {
    let code = qrcode::QrCode::new(text.as_bytes()).expect("qr");
    let img = code.render::<image::Luma<u8>>().min_dimensions(320, 320).quiet_zone(true).build();
    let rgba = image::DynamicImage::ImageLuma8(img).to_rgba8();
    crate::images::encode_png(&rgba)
}

const PHONE_HTML: &str = r##"<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0d12"><title>Corel · Phone relay</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0b0d12;color:#ecebf5;font:14px/1.45 -apple-system,"Segoe UI",Roboto,sans-serif;min-height:100vh;
background:radial-gradient(500px 300px at 0 0,rgba(34,197,94,.10),transparent 60%),#0b0d12;padding:18px 16px 110px}
.top{display:flex;align-items:center;gap:12px;margin-bottom:16px}.logo{width:38px;height:38px;border-radius:10px;background:#11141a;display:grid;place-items:center;box-shadow:inset 0 0 0 1px #23262e}
.logo svg{width:28px;height:28px}.top b{display:block;font-size:16px}.top span{color:#8d8c9e;font-size:12px}
.card{background:#12151c;border-radius:16px;box-shadow:inset 0 0 0 1px #23242e;padding:14px;margin-bottom:12px}
.acct{display:flex;align-items:center;gap:12px}.av{width:36px;height:36px;border-radius:50%;background:#22c55e;display:grid;place-items:center;font-weight:700}
.acct .g{flex:1}.acct small{color:#5f5e70;display:block}.ok{background:rgba(61,220,151,.12);color:#4ade80;font-size:11px;font-weight:600;padding:3px 9px;border-radius:7px}
.lbl{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#5f5e70;font-weight:600;margin:18px 4px 10px}
.up{background:#12161d;box-shadow:inset 0 0 0 1px rgba(34,197,94,.25)}
.up.done{background:linear-gradient(120deg,#123a2c,#131f1d);box-shadow:inset 0 0 0 1px rgba(61,220,151,.25)}
.row{display:flex;gap:12px;align-items:center}.row img{width:58px;height:58px;border-radius:12px}.row .g{flex:1;min-width:0}
.nm{font-weight:700}.big{font-size:28px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}.meta{color:#a8a3c9;font-size:12px}
.pills{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}.pill{font-size:11px;font-weight:600;padding:3px 9px;border-radius:7px;background:rgba(255,255,255,.07);color:#b3b0c9}
.pill.p{background:rgba(34,197,94,.10);color:#b5acff}.pill.g{background:rgba(61,220,151,.15);color:#4ade80}
.steps{display:flex;gap:6px;margin-top:12px}.steps div{flex:1;text-align:center;font-size:10.5px;color:#8d8c9e}.steps img{width:100%;aspect-ratio:1;border-radius:8px;display:block;margin-bottom:4px;opacity:.45}
.steps .on img{opacity:1;box-shadow:0 0 0 2px #4ade80}.steps .on{color:#4ade80}.steps .ok2 img{opacity:.8}
.empty{color:#5f5e70;text-align:center;padding:30px 10px}
.toast{position:fixed;left:16px;right:16px;bottom:88px;background:#1a1b23;box-shadow:inset 0 0 0 1px #2c2d39;border-radius:12px;padding:11px 14px;display:flex;gap:10px;align-items:center;transition:opacity .3s}
.dot{width:16px;height:16px;border-radius:50%;background:#4ade80;display:grid;place-items:center;color:#07261a;font-size:11px;font-weight:900}
.btn{position:fixed;left:50%;transform:translateX(-50%);bottom:24px;height:48px;padding:0 28px;border-radius:14px;border:0;color:#fff;font:600 14px inherit;background:#22c55e;color:#04210f}
.off{color:#f87171}
</style></head><body>
<div class="top"><div class="logo"><svg viewBox="0 0 1024 1024"><g stroke="#11141a" stroke-width="40" stroke-linejoin="round"><path d="M512 214 770 363 512 512 254 363Z" fill="#4ade80"/><path d="M254 363 512 512 512 810 254 661Z" fill="#22c55e"/><path d="M512 512 770 363 770 661 512 810Z" fill="#15803d"/></g></svg></div>
<div><b>Corel</b><span>Phone relay</span></div></div>
<div class="card acct" id="acct"></div>
<div class="lbl">Updates</div><div id="list"></div>
<div class="toast" id="toast"><div class="dot">✓</div><span id="tt">Connected to your PC.</span></div>
<button class="btn" onclick="load(true)">Refresh</button>
<script>
const T=new URLSearchParams(location.search).get('t');let S=null,skew=0;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const img=n=>n?`/img?t=${encodeURIComponent(T)}&n=${encodeURIComponent(n)}`:'';
function left(ms){if(ms<=0)return'now';const s=Math.floor(ms/1000),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);
return d?`${d}d ${h}h`:h?`${h}h ${String(m).padStart(2,'0')}m`:`${m}m ${String(s%60).padStart(2,'0')}s`}
function when(t){const d=new Date(t);return d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})+' at '+d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit',hour12:!(S&&S.use24h)})}
function render(){if(!S)return;const now=Date.now()+skew;const a=S.account;
document.getElementById('acct').innerHTML=a?`<div class="av">${esc((a.name||'?')[0].toUpperCase())}</div><div class="g"><b>${esc(a.name)}</b><small>${a.handle?'@'+esc(a.handle):''}</small></div><span class="ok">✓ Signed in</span>`:`<div class="g"><b>No Roblox key yet</b><small>Add one in the desktop app</small></div>`;
const L=S.experiences.filter(e=>e.update);document.getElementById('list').innerHTML=L.length?L.map(e=>{const u=e.update,act=['preparing','scheduled','restoring'].includes(u.status);
const next=u.steps.find(s=>['upcoming','waiting','retrying'].includes(s.apply));const live=[...u.steps].reverse().find(s=>s.apply==='live'||s.apply==='done');
const ic=img(live?live.image:e.icon);return `<div class="card up ${act?'':'done'}"><div class="row">${ic?`<img src="${ic}">`:''}<div class="g"><div class="nm">${esc(e.name)}</div>
<div class="big">${act?left(u.at-now):u.status==='done'?'Live':'Cancelled'}</div><div class="meta">${esc(when(u.at))}</div></div></div>
<div class="pills">${act&&next?`<span class="pill p">${esc(next.label)} in ${left(next.at-now)}</span>`:''}${!act&&u.status==='done'?'<span class="pill g">New icon applied</span>':''}<span class="pill">${u.placeNames.length} place(s)</span></div>
<div class="steps">${u.steps.map(s=>`<div class="${s.apply==='live'?'on':s.apply==='done'?'ok2':''}"><img src="${img(s.image)}">${esc(s.label)}</div>`).join('')}</div></div>`}).join(''):'<div class="empty">No updates scheduled yet.<br>Schedule one in Corel on your PC.</div>'}
async function load(manual){try{const r=await fetch('/api/state?t='+encodeURIComponent(T),{cache:'no-store'});if(!r.ok)throw 0;S=await r.json();skew=S.now-Date.now();render();
toast(manual?'Updated.':'Connected to your PC.')}catch(e){toast('Can\'t reach your PC. Is it on and on the same Wi-Fi?',true)}}
let tt;function toast(m,bad){const t=document.getElementById('toast');document.getElementById('tt').textContent=m;t.querySelector('.dot').style.background=bad?'#f87171':'#4ade80';t.style.opacity=1;clearTimeout(tt);tt=setTimeout(()=>t.style.opacity=0,2500)}
load();setInterval(render,1000);setInterval(load,15000);
</script></body></html>"##;
