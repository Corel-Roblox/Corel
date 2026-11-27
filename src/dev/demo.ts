// Development only (loaded from main.tsx when the dev server is opened with ?demo).
// Fills the stores with sample data for screenshots and UI work without a backend.
// Never included in release builds.
import { useSession } from '@/store/session';
import { useWorkspace } from '@/store/workspace';
import { usePresence } from '@/store/presence';
import type { Activity, Bug, Member, Profile, Project, PublishUpdate, Script, Task } from '@/lib/types';

export function loadDemo() {
  const now = Date.now();
  const iso = (min: number) => new Date(now - min * 60_000).toISOString();
  const T = '0d1a5c3e-0000-4000-8000-000000000001';
  const U = ['5f0c2a91-1b2c-4d3e-9f10-aa01bb02cc03', 'a83e1f40-7d6c-4b5a-8e9f-0102030405a6', '2c9d8e7f-6a5b-4c3d-8e2f-1a2b3c4d5e6f', 'e4f5a6b7-c8d9-4e0f-9a1b-2c3d4e5f6a7b', '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'];
  const names = ['Jake', 'Alex Rivera', 'Sam Lee', 'Mia Chen', 'Leo Park'];
  const profile = (i: number): Profile => ({ id: U[i], email: `${names[i].split(' ')[0].toLowerCase()}@blocky.dev`, display_name: names[i], username: null, avatar_url: null, roblox_username: null, bio: '', notification_prefs: {}, last_seen_at: iso(15 + i * 40), created_at: iso(90000) });
  const roles: Member['role'][] = ['owner', 'admin', 'developer', 'developer', 'viewer'];
  const P = ['6b1f0000-0000-4000-8000-000000000001', '6b1f0000-0000-4000-8000-000000000002', '6b1f0000-0000-4000-8000-000000000003', '6b1f0000-0000-4000-8000-000000000004'];
  const proj = (i: number, name: string, desc: string, uni: string | null): Project => ({ id: P[i], team_id: T, name, description: desc, thumbnail_url: null, place_id: uni ? String(Number(uni) * 3 + 11) : null, universe_id: uni, color: 'green', visibility: i === 3 ? 'members' : 'team', archived: false, created_by: U[i % 3], created_at: iso(80000 - i * 9000), updated_at: iso(30 + i * 200) });
  const projects = [
    proj(0, 'Sky Obby', 'Floating obstacle course with 120 stages and seasonal events.', '4820193'),
    proj(1, 'Tycoon Rush', 'Factory tycoon with trading and rebirths.', '5193847'),
    proj(2, 'Deep Dive', 'Co-op underwater exploration with procedural caves.', '6610274'),
    proj(3, 'Racing League', 'Competitive kart racing, ranked seasons.', null),
  ];
  const bug = (n: number, p: number, title: string, severity: Bug['severity'], status: Bug['status'], a: number | null, r: number, age: number): Bug => ({ id: `b0000000-0000-4000-8000-0000000000${n}`, team_id: T, project_id: P[p], number: n, title, description: 'After respawning, the lobby floor loses collision for about two seconds and players fall into the void.', steps: '1. Join a live server\n2. Reset your character in the lobby\n3. Walk forward immediately', environment: 'Mobile (iOS) · live server · place v412', severity, status, assignee_id: a === null ? null : U[a], reporter_id: U[r], created_at: iso(age), updated_at: iso(age / 3), fixed_at: status === 'fixed' || status === 'closed' ? iso(age / 4) : null });
  const bugs = [
    bug(31, 0, 'Players fall through the floor after respawn', 'critical', 'confirmed', 1, 2, 95),
    bug(30, 1, 'Rebirth button stays disabled after purchase', 'high', 'in_progress', 0, 3, 260),
    bug(29, 0, 'Stage 87 checkpoint saves the wrong position', 'medium', 'reported', null, 4, 400),
    bug(28, 2, 'Sonar ping sound plays twice on mobile', 'low', 'reported', 3, 1, 900),
    bug(27, 1, 'Conveyor speed resets when the server restarts', 'medium', 'fixed', 1, 0, 2400),
    bug(26, 0, 'Leaderboard shows stale stage after teleport', 'high', 'fixed', 2, 1, 3100),
    bug(25, 2, 'Oxygen meter overlaps the chat on small screens', 'low', 'closed', 3, 2, 5200),
  ];
  const task = (i: number, p: number, title: string, status: Task['status'], priority: Task['priority'], a: number | null, due?: string): Task => ({ id: `c0000000-0000-4000-8000-00000000000${i}`, team_id: T, project_id: P[p], title, description: '', status, priority, assignee_id: a === null ? null : U[a], due_date: due ?? null, position: i, created_by: U[0], created_at: iso(3000 - i * 100), updated_at: iso(100 + i), completed_at: status === 'done' ? iso(300 + i * 60) : null });
  const day = (d: number) => new Date(now + d * 86400_000).toISOString().slice(0, 10);
  const tasks = [
    task(1, 0, 'Build the winter lobby', 'in_progress', 'high', 0, day(2)),
    task(2, 0, 'Stages 121–130', 'todo', 'medium', 1, day(6)),
    task(3, 0, 'Snowball event script', 'todo', 'urgent', 2, day(1)),
    task(4, 0, 'Fix checkpoint saving', 'done', 'none', 1),
    task(5, 0, 'Winter update thumbnail', 'in_progress', 'low', 3),
    task(6, 0, 'Playtest new stages', 'todo', 'none', null),
    task(7, 0, 'Update store page description', 'done', 'low', 0),
    task(8, 1, 'Trading UI pass', 'in_progress', 'medium', 0, day(3)),
  ];
  const code = `--!strict\n-- Loads and saves player data with session locking.\nlocal DataStoreService = game:GetService("DataStoreService")\nlocal Players = game:GetService("Players")\n\nlocal store = DataStoreService:GetDataStore("PlayerData_v3")\nlocal DataService = {}\nlocal cache: { [number]: PlayerData } = {}\n\nexport type PlayerData = {\n\tcoins: number,\n\tstage: number,\n\tinventory: { string },\n}\n\nlocal DEFAULT: PlayerData = { coins = 0, stage = 1, inventory = {} }\n\nfunction DataService.load(player: Player): PlayerData\n\tlocal ok, data = pcall(function()\n\t\treturn store:GetAsync(\`player_\${player.UserId}\`)\n\tend)\n\tif not ok then\n\t\twarn("Failed to load data for", player.Name, data)\n\t\tdata = nil\n\tend\n\tlocal result = data or table.clone(DEFAULT)\n\tcache[player.UserId] = result\n\treturn result\nend\n\nfunction DataService.save(player: Player)\n\tlocal data = cache[player.UserId]\n\tif not data then\n\t\treturn\n\tend\n\tstore:SetAsync(\`player_\${player.UserId}\`, data)\nend\n\nPlayers.PlayerRemoving:Connect(DataService.save)\n\nreturn DataService\n`;
  const script = (i: number, name: string, category: string, tags: string[], v: number, by: number, age: number, content = code): Script => ({ id: `d0000000-0000-4000-8000-00000000000${i}`, team_id: T, folder_id: null, name, description: i === 1 ? 'Profile loading with session locking and caching.' : '', category, tags, content, visibility: i === 4 ? 'projects' : 'team', shared_project_ids: i === 4 ? [P[0]] : [], version: v, created_by: U[0], updated_by: U[by], created_at: iso(60000), updated_at: iso(age) });
  const scripts = [
    script(1, 'DataService', 'Module', ['data', 'server'], 7, 1, 22),
    script(2, 'TweenUtil', 'Utility', ['ui'], 3, 0, 300),
    script(3, 'RemoteGuard', 'Networking', ['security', 'server'], 5, 2, 1400),
    script(4, 'SnowballEvent', 'Server', ['event', 'winter'], 2, 2, 45),
    script(5, 'ShopController', 'Client', ['ui', 'economy'], 9, 3, 2600),
  ];
  const publish: PublishUpdate[] = [
    { id: 'e0000000-0000-4000-8000-000000000001', team_id: T, project_id: P[0], local_update_id: 'demo1', scheduled_by: U[0], machine: 'JAKE-PC', update_at: new Date(now + 5 * 3600_000 + 18 * 60_000).toISOString(), status: 'scheduled', steps: [{ label: 'H-12', at: now - 7 * 3600_000, upload: 'done', moderation: 'Approved', apply: 'done' }, { label: 'H-6', at: now - 3600_000, upload: 'done', moderation: 'Approved', apply: 'live' }], place_names: ['Sky Obby', 'Winter Hub'], announcement_title: 'Winter Update', announcement_body: '', created_at: iso(800), updated_at: iso(60), finished_at: null },
    { id: 'e0000000-0000-4000-8000-000000000002', team_id: T, project_id: P[2], local_update_id: 'demo2', scheduled_by: U[3], machine: 'MIA-LAPTOP', update_at: new Date(now + 2 * 86400_000 + 3 * 3600_000).toISOString(), status: 'preparing', steps: [], place_names: ['Deep Dive'], announcement_title: 'Abyss Expansion', announcement_body: '', created_at: iso(120), updated_at: iso(20), finished_at: null },
  ];
  const act = (id: number, p: number | null, actor: number, verb: string, type: string, summary: string, age: number): Activity => ({ id, team_id: T, project_id: p === null ? null : P[p], actor_id: U[actor], verb, entity_type: type, entity_id: type === 'bug' ? bugs[0].id : type === 'script' ? scripts[0].id : null, summary, meta: {}, created_at: iso(age) });
  const activity = [
    act(12, 0, 1, 'commented', 'bug', 'commented on BUG-31', 4),
    act(11, 0, 2, 'status', 'bug', 'moved BUG-31 to confirmed', 18),
    act(10, null, 1, 'edited', 'script', 'edited script DataService', 22),
    act(9, 0, 0, 'completed', 'task', 'completed task Update store page description', 40),
    act(8, null, 2, 'created', 'script', 'created script SnowballEvent', 45),
    act(7, 0, 0, 'scheduled', 'update', 'scheduled an update for Sky Obby', 800),
    act(6, 2, 3, 'scheduled', 'update', 'scheduled an update for Deep Dive', 120),
    act(5, 1, 3, 'created', 'bug', 'reported BUG-30: Rebirth button stays disabled after purchase', 260),
    act(4, null, 4, 'joined', 'member', 'joined the team', 1500),
    act(3, 0, 1, 'status', 'bug', 'marked BUG-26 as fixed', 1700),
  ];
  useSession.setState({ status: 'signed-in', user: { id: U[0], email: 'jake@blocky.dev' } as never, profile: profile(0) });
  useWorkspace.setState({
    teamsLoaded: true,
    teamId: T,
    realtime: 'live',
    teams: [{ id: T, name: 'Blocky Studios', color: 'green', created_by: U[0], created_at: iso(90000) }],
    members: U.map((id, i) => ({ team_id: T, user_id: id, role: roles[i], permissions: {}, joined_at: iso(90000 - i * 9000) })),
    profiles: Object.fromEntries(U.map((id, i) => [id, profile(i)])),
    projects,
    projectMembers: [],
    bugs,
    tasks,
    scripts,
    folders: [],
    favorites: [scripts[0].id],
    publish,
    activity,
    invites: [],
  });
  usePresence.setState({
    online: {
      [U[0]]: { user_id: U[0], route: '/', online_at: iso(0) },
      [U[1]]: { user_id: U[1], route: `/projects/${P[0]}`, project_id: P[0], online_at: iso(1) },
      [U[2]]: { user_id: U[2], route: `/scripts/${scripts[0].id}`, online_at: iso(2) },
    },
  });
}

export const isDemo = () => import.meta.env.DEV && new URLSearchParams(location.search).has('demo');
