# Roicon

Countdown icons for Roblox. On autopilot. A native Windows app written in Rust (egui).

You pick your current icon, your new icon and an update time. Roicon builds the
countdown icons (12 Hours, 6 Hours, 3 Hours, 1 Hour), uploads them to Roblox early so they
pass moderation in time, then switches the icon on every place you chose at each step.
When the update time hits, the new icon goes live.

## Run it

`dist/Roicon.exe` (or the latest GitHub release). No install needed. It keeps running in the tray so updates happen on time.

## Connect your Roblox account

Open Settings (bottom left) and press **Connect with Roblox**. Roblox's sign-in page opens in
your browser; pick your account (and any groups that own your games) and press **Select**.

Roicon's OAuth app Client ID is built in. The first time, paste the app's Client Secret under
"Sign in with Roblox setup" in Settings; it is kept in Windows Credential Manager and is never
included in the source or the .exe.

OAuth app settings (Creator Hub → OAuth 2.0 Apps):

- Redirect URL: `http://localhost:52817/callback`
- Scopes: `openid`, `profile`, `asset:read`, `asset:write`
- Entry link: https://jakedev2.github.io/Roicon/
- Privacy Policy: https://jakedev2.github.io/Roicon/privacy.html
- Terms of Service: https://jakedev2.github.io/Roicon/terms.html

Private OAuth apps work for up to 10 Roblox accounts. For group games, select the group on
Roblox's page.

You can also use an Open Cloud API key instead (Settings → Advanced): Assets API with
Read and Write.

## How it talks to Roblox

- Upload images: `POST https://apis.roblox.com/assets/v1/assets` (Open Use, so they can be place icons)
- Moderation state: `GET /assets/v1/assets/{id}?readMask=moderationResult`
- Set a place's icon: `PATCH /assets/v1/assets/{placeId}?updateMask=icon`
- Game info, places and the current icon come from Roblox's public web APIs.

## Phone relay

**Send to phone** shows a QR code. Scan it on the same Wi-Fi to see the countdown live on your
phone. This PC does the icon switching, so leave it on (it can sit in the tray).

## Build

```
cargo build --release
```

Data lives in `%APPDATA%\Roicon`. Secrets (sign-in token, client secret, API key)
are stored in Windows Credential Manager.

## Website

The `docs/` folder is the GitHub Pages site (home page, privacy policy, terms).
