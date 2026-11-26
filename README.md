# Roicon

Countdown icons for Roblox. On autopilot. A native Windows app written in Rust (egui).

You pick your current icon, your new icon and an update time. Roicon builds the
countdown icons (12 Hours, 6 Hours, 3 Hours, 1 Hour), uploads them to Roblox early so they
pass moderation in time, then switches the icon on every place you chose at each step.
When the update time hits, the new icon goes live.

## Run it

`dist/Roicon.exe` (or the latest GitHub release). Running it installs Roicon to `%LOCALAPPDATA%\Programs\Roicon`, adds Desktop and Start menu shortcuts, and keeps it up to date from GitHub releases (`--portable` skips the install). It keeps running in the tray so updates happen on time.

## Connect your Roblox account

Open Settings (bottom left) and press **Connect with Roblox**. Roblox's sign-in page opens in
your browser; pick your account (and any groups that own your games) and press **Select**.
Your Roblox profile then shows in the bottom-left corner.

The OAuth client ID and secret are built into the app, so users never see or edit them.
The secret is not in this repository: release builds get it from the `ROICON_CLIENT_SECRET`
GitHub Actions secret (see `.github/workflows/release.yml`).

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
$env:ROICON_CLIENT_SECRET = "<client secret>"   # optional; without it, Sign in with Roblox is disabled
cargo build --release
```

Releases: push a tag like `v1.1.0` and the Release workflow builds `Roicon.exe` with the
secret from GitHub Secrets and attaches it to the GitHub release.

Data lives in `%APPDATA%\Roicon`. Secrets (sign-in token, client secret, API key)
are stored in Windows Credential Manager.

## Website

The `docs/` folder is the GitHub Pages site (home page, privacy policy, terms).
