// Row types for the Corel schema (supabase/migrations) and the local engine.

export type Role = 'owner' | 'admin' | 'developer' | 'viewer';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type BugStatus = 'reported' | 'confirmed' | 'in_progress' | 'fixed' | 'closed';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent';
export type Perm = 'manage_members' | 'manage_projects' | 'edit_content' | 'comment' | 'manage_scripts' | 'manage_publish' | 'view_analytics';

export interface Profile {
  id: string;
  email: string | null;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  roblox_username: string | null;
  bio: string;
  notification_prefs: Record<string, boolean>;
  last_seen_at: string | null;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  color: string;
  avatar_url?: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Member {
  team_id: string;
  user_id: string;
  role: Role;
  permissions: Partial<Record<Perm, boolean>>;
  joined_at: string;
}

export interface Invite {
  id: string;
  team_id: string;
  email: string | null;
  token: string;
  role: Role;
  invited_by: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  uses: number;
  expires_at: string;
  created_at: string;
}

export interface Project {
  id: string;
  team_id: string;
  name: string;
  description: string;
  thumbnail_url: string | null;
  place_id: string | null;
  universe_id: string | null;
  color: string;
  visibility: 'team' | 'members';
  archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: Role;
  added_at: string;
}

export interface Task {
  id: string;
  team_id: string;
  project_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  due_date: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Bug {
  id: string;
  team_id: string;
  project_id: string;
  number: number;
  title: string;
  description: string;
  steps: string;
  environment: string;
  severity: Severity;
  status: BugStatus;
  assignee_id: string | null;
  reporter_id: string | null;
  created_at: string;
  updated_at: string;
  fixed_at: string | null;
}

export interface Attachment {
  id: string;
  team_id: string;
  bug_id: string;
  path: string;
  name: string;
  size: number;
  mime: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface Comment {
  id: string;
  team_id: string;
  project_id: string;
  entity_type: 'bug' | 'task';
  entity_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
}

export interface ScriptFolder {
  id: string;
  team_id: string;
  parent_id: string | null;
  name: string;
  created_by: string | null;
  created_at: string;
}

export interface Script {
  id: string;
  team_id: string;
  folder_id: string | null;
  name: string;
  description: string;
  category: string;
  tags: string[];
  content: string;
  visibility: 'team' | 'projects' | 'private';
  shared_project_ids: string[];
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScriptVersion {
  id: string;
  script_id: string;
  team_id: string;
  version: number;
  content: string;
  message: string;
  edited_by: string | null;
  created_at: string;
}

export interface PublishStepSummary {
  label: string;
  at: number | null;
  upload: string;
  moderation: string;
  apply: string;
}

export interface PublishUpdate {
  id: string;
  team_id: string;
  project_id: string;
  local_update_id: string;
  scheduled_by: string | null;
  machine: string;
  update_at: string;
  status: 'preparing' | 'scheduled' | 'restoring' | 'done' | 'cancelled';
  steps: PublishStepSummary[];
  place_names: string[];
  announcement_title: string;
  announcement_body: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface Snapshot {
  id: number;
  team_id: string;
  project_id: string;
  bucket: number;
  captured_at: string;
  visits: number | null;
  playing: number | null;
  favorites: number | null;
  up_votes: number | null;
  down_votes: number | null;
}

export interface MetricRow {
  team_id: string;
  project_id: string;
  metric: string;
  day: string;
  value: number;
  source: string;
}

export interface Activity {
  id: number;
  team_id: string;
  project_id: string | null;
  actor_id: string | null;
  verb: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface Notification {
  id: number;
  user_id: string;
  team_id: string | null;
  kind: string;
  title: string;
  body: string;
  link: { type?: string; id?: string; project?: string };
  actor_id: string | null;
  read_at: string | null;
  created_at: string;
}

// ------------------------------------------------------------ local engine (Rust store.rs)

export type EngineStatus = 'preparing' | 'scheduled' | 'restoring' | 'done' | 'cancelled';
export type UploadState = 'pending' | 'uploading' | 'done' | 'error' | 'skipped';
export type ApplyState = 'upcoming' | 'waiting' | 'retrying' | 'live' | 'done' | 'skipped' | 'error' | 'standby';

export interface EngineTimer {
  id: string;
  hours: number;
  label: string;
  overlay: string | null;
}

export interface EngineStep {
  id: string;
  key: string;
  label: string;
  at: number | null;
  hidden: boolean;
  image: string;
  asset_id: string | null;
  upload: UploadState;
  moderation: string;
  apply: ApplyState;
  places_done: string[];
  error: string | null;
  tries: number;
  applied_at: number | null;
}

export interface EngineUpdate {
  id: string;
  at: number;
  started_at: number;
  place_ids: string[];
  place_names: string[];
  status: EngineStatus;
  steps: EngineStep[];
  log: { t: number; msg: string }[];
  finished_at: number | null;
}

export interface EngineExperience {
  id: string;
  universe_id: string;
  root_place_id: string;
  name: string;
  creator: { kind: string; id: string; name: string };
  rating: number | null;
  playing: number;
  places: { id: string; name: string; enabled: boolean }[];
  current_icon: string | null;
  new_icon: string | null;
  timers: EngineTimer[];
  planned_at: number | null;
  update: EngineUpdate | null;
  history: { id: string; at: number; status: EngineStatus; finished_at: number }[];
  project_id: string | null;
  announce_title: string;
  announce_body: string;
}

export interface EngineAccount {
  user_id: string | null;
  name: string | null;
  display_name: string | null;
  key_name: string | null;
  method: string;
  avatar: string | null;
  granted: { kind: string; id: string; name: string; avatar: string | null }[];
}

export interface EngineState {
  settings: { close_to_tray: boolean; launch_at_login: boolean; notifications: boolean; use_24h: boolean; auto_update: boolean };
  account: EngineAccount | null;
  experiences: EngineExperience[];
  hasCredential: boolean;
  usesOauth: boolean;
  hasApiKey: boolean;
  now: number;
}

export interface GameStats {
  universeId: string;
  name: string | null;
  visits: number | null;
  playing: number | null;
  favorites: number | null;
  upVotes: number | null;
  downVotes: number | null;
  updated: string | null;
  maxPlayers: number | null;
}

export interface ResolvedGame {
  universeId: string;
  rootPlaceId: string;
  name: string;
  creatorKind: string;
  creatorId: string;
  creatorName: string;
  playing: number;
  iconUrl: string | null;
}
