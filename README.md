# Corel

Website: [corel.site](https://corel.site)

**The workspace for Roblox development teams.** Projects, publishing, analytics, bug
tracking, a shared Luau script library and real-time collaboration in one Windows desktop app.

Corel is the successor to Roicon. The countdown-icon publishing engine is still here
(now the **Publish** section), and Corel imports a Roicon install's experiences, schedules and sign-in.

| Section | What it does |
|---|---|
| **Overview** | Workspace numbers, upcoming updates, live activity, recent bugs and scripts, game performance, quick actions. Widgets can be hidden and dragged into a new order. |
| **Projects** | One project per Roblox experience (universe ID, place ID, thumbnail, description, visibility). Each has its own workspace: overview, task board, bugs, scripts, publishing, analytics, members with project roles, activity and settings. |
| **Publish** | Set the current and new icon, pick a time, and Corel uploads countdown icons (12h / 6h / 3h / 1h, or your own steps and overlay art) early so they pass moderation, then switches the icon on every chosen place at each step. Update announcements with a preview, live step tracking, cancel-and-restore, history shared with the team, and a phone relay. |
| **Analytics** | Visits, players online, favorites and rating from Roblox's public numbers, captured every 15 minutes while Corel is open, with date ranges and side-by-side comparison. Revenue, DAU, session time and retention come from Creator Hub CSV exports you import (Roblox has no public API for them). Missing data is shown as "Not available", never as zero; sample charts are labelled **Demo data**. |
| **Bugs** | Reports with severity, status, assignee, steps, environment and attachments; dashboard (unresolved, critical, recently fixed, per developer); search, filters and sorting; live comments with typing indicators; full history. |
| **Scripts** | Luau editor (syntax highlighting, auto-indent, formatter, completions), folders, categories, tags, favorites, sharing with the team, selected projects or only you, presence, conflict-safe saving and version history with diff and restore. |
| **Team** | Invite by email or link, accept/decline, roles (Owner, Admin, Developer, Viewer), per-member permission overrides, shared projects, online status and last-active times, activity feed filtered by project and event type. |

Global search (`Ctrl K`), a notification center, toasts, keyboard shortcuts (`?` lists them)
and settings for theme, accent colour, profile, security (password, email, two-factor,
sessions), notifications, integrations, desktop behaviour and data export.

Collaboration in Corel covers the workspace above. It is not Roblox Studio's Team Create:
Corel does not edit places in Studio.

## How it's built

- **Desktop shell:** Tauri 2 (Rust, `src-tauri/`). The Roicon engine is kept as-is:
  `scheduler.rs` (uploads, moderation polling, timed icon switches), `roblox.rs`
  (Open Cloud + public APIs), `oauth.rs` (Sign in with Roblox, PKCE), `images.rs`
  (countdown compositing), `relay.rs` (phone relay), `install.rs` (self-installer and
  auto-updater), `store.rs` (local state). `commands.rs` exposes them to the UI;
  `secure.rs` encrypts the workspace session with Windows DPAPI.
- **UI:** React + TypeScript + Tailwind (`src/`), Lucide icons, Radix primitives,
  Recharts, CodeMirror 6 with a Luau mode. Design tokens live in `src/styles.css`;
  the design system is in `design-system/corel/MASTER.md`.
- **Workspace server:** Supabase (Postgres, Auth, Realtime, Storage). Schema, row level
  security, triggers and RPCs are in `supabase/migrations/`.

Why the UI moved from egui to a web view: the new product needs rich text editing, a code
editor, charts, accessible menus/dialogs and the Supabase Realtime client, which are mature
on the web stack. All Rust logic was kept and is still what talks to Roblox.

### Security model

- Roblox tokens, the API key and the OAuth client secret never reach the web view. They
  stay in Rust and Windows Credential Manager.
- The workspace session is encrypted with DPAPI (tied to the Windows user).
- The Supabase URL and **anon** key are public by design. Every table has row level
  security; activity and notifications are written only by database triggers; script
  content can only change through `save_script()`, which rejects stale saves; realtime
  presence channels are private and limited to team members. Never ship the
  `service_role` key.

### Real-time collaboration

Supabase Realtime `postgres_changes` streams every insert/update/delete the user is
allowed to see (projects, bugs, tasks, comments, scripts, publishing, activity,
notifications, members). Presence on private channels drives online indicators, "who's
viewing this project", script editors and comment typing indicators. After a dropped
connection the workspace is re-fetched so nothing is missed. No polling is used for
collaboration.

## Data

- `%APPDATA%\Corel`: publishing schedules and icon images (copied from `%APPDATA%\Roicon`
  on first start; the old folder is left untouched), the encrypted session in `secure\`.
- Windows Credential Manager: Roblox sign-in and API key (migrated from Roicon's entries).
- Everything else lives in your Supabase project. Settings → Data management exports a team as JSON.

## Testing the database

The migration was exercised with an in-memory Postgres (PGlite) covering invites, roles,
permission overrides, bug numbering, notifications, conflict-safe script saves, snapshot
de-duplication and member removal.
