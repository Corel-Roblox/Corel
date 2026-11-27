// The local publishing engine (Rust scheduler). This PC uploads countdown icons,
// waits for Roblox moderation and switches place icons on time. Its progress is
// mirrored to the team's publish_updates table so teammates see the same status;
// a step is only reported as live after Roblox accepted the icon change.
import { createWithEqualityFn as create } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { invoke, isDesktop, listen, type AppInfo, appInfo } from '@/lib/tauri';
import type { EngineExperience, EngineState, PublishStepSummary } from '@/lib/types';
import { getSupabase } from '@/lib/supabase';
import { useWorkspace } from './workspace';
import { hasPerm, projectPerm } from '@/lib/perms';
import { useSession } from './session';

interface EngineStore {
  state: EngineState | null;
  info: AppInfo | null;
  error: string | null;
  start: () => Promise<void>;
  refresh: () => Promise<void>;
}

let started = false;
let pending: number | undefined;
const synced = new Map<string, string>();

export const useEngine = create<EngineStore>()((set, get) => ({
  state: null,
  info: null,
  error: null,
  start: async () => {
    if (started) return;
    started = true;
    set({ info: await appInfo() });
    if (!isDesktop) return;
    await get().refresh();
    await listen('engine-changed', () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => get().refresh(), 120);
    });
    await listen<string>('update-ready', async () => set({ info: await appInfo() }));
  },
  refresh: async () => {
    try {
      const state = await invoke<EngineState>('engine_state');
      set({ state, error: null });
      syncToTeam(state.experiences);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },
}), shallow);

export function syncToTeam(exps: EngineExperience[]) {
  const supabase = getSupabase();
  const ws = useWorkspace.getState();
  const uid = useSession.getState().user?.id;
  if (!supabase || !ws.teamId || !uid) return;
  const me = ws.members.find((m) => m.user_id === uid);
  const machine = useEngine.getState().info?.machine ?? '';
  for (const e of exps) {
    const u = e.update;
    if (!u || !e.project_id) continue;
    const project = ws.projects.find((p) => p.id === e.project_id);
    if (!project) continue;
    const prole = ws.projectMembers.find((m) => m.project_id === project.id && m.user_id === uid)?.role;
    if (!projectPerm(me, prole, 'manage_publish') && !hasPerm(me, 'manage_publish')) continue;
    const steps: PublishStepSummary[] = u.steps.filter((s) => !s.hidden).map((s) => ({ label: s.label, at: s.at, upload: s.upload, moderation: s.moderation, apply: s.apply }));
    const row = {
      project_id: project.id,
      team_id: project.team_id,
      local_update_id: u.id,
      machine,
      update_at: new Date(u.at).toISOString(),
      status: u.status,
      steps,
      place_names: u.place_names,
      announcement_title: e.announce_title,
      announcement_body: e.announce_body,
      finished_at: u.finished_at ? new Date(u.finished_at).toISOString() : null,
    };
    const sig = JSON.stringify(row);
    if (synced.get(u.id) === sig) continue;
    synced.set(u.id, sig);
    supabase
      .from('publish_updates')
      .upsert({ ...row, scheduled_by: uid }, { onConflict: 'local_update_id', ignoreDuplicates: false })
      .then(({ error }) => {
        if (error) synced.delete(u.id);
      });
  }
}

export const STATUS_LABEL: Record<string, string> = {
  preparing: 'Preparing',
  scheduled: 'Scheduled',
  restoring: 'Restoring original icon',
  done: 'Published',
  cancelled: 'Cancelled',
};
