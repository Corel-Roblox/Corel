// Background jobs that run while the app is open:
//  - Analytics collector: every 15 minutes, read the public numbers Roblox shows for
//    each project with a universe ID and store them as a snapshot (deduplicated per
//    15-minute window on the server, so several teammates running Corel is fine).
//  - Publishing reminders: a toast + desktop notification 1 hour and 10 minutes
//    before any scheduled update in the team.
import { toast } from 'sonner';
import { invoke, isDesktop } from './tauri';
import { getSupabase } from './supabase';
import type { GameStats } from './types';
import { useWorkspace } from '@/store/workspace';
import { usePrefs } from '@/store/prefs';
import { countdown } from './format';

let collectorTimer: number | undefined;
let reminderTimer: number | undefined;
const reminded = new Set<string>();

export async function collectSnapshots(): Promise<{ captured: number; error?: string }> {
  const supabase = getSupabase();
  const ws = useWorkspace.getState();
  if (!supabase || !ws.teamId || !isDesktop) return { captured: 0 };
  const projects = ws.projects.filter((p) => p.universe_id && !p.archived);
  if (!projects.length) return { captured: 0 };
  try {
    const stats = await invoke<GameStats[]>('roblox_game_stats', { universeIds: [...new Set(projects.map((p) => p.universe_id!))] });
    const rows = projects
      .map((p) => {
        const s = stats.find((x) => x.universeId === p.universe_id);
        if (!s || (s.visits === null && s.playing === null)) return null;
        return { project_id: p.id, visits: s.visits, playing: s.playing, favorites: s.favorites, up_votes: s.upVotes, down_votes: s.downVotes };
      })
      .filter(Boolean);
    if (!rows.length) return { captured: 0 };
    const { data, error } = await supabase.rpc('record_snapshots', { p_rows: rows });
    if (error) return { captured: 0, error: error.message };
    return { captured: (data as number) ?? 0 };
  } catch (e) {
    return { captured: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

function checkReminders() {
  if (!usePrefs.getState().publishReminders) return;
  const ws = useWorkspace.getState();
  const now = Date.now();
  for (const u of ws.publish) {
    if (!['preparing', 'scheduled'].includes(u.status)) continue;
    const left = new Date(u.update_at).getTime() - now;
    const name = ws.projects.find((p) => p.id === u.project_id)?.name ?? 'An experience';
    for (const mark of [60, 10]) {
      const key = `${u.id}:${mark}`;
      if (left > 0 && left <= mark * 60_000 && !reminded.has(key)) {
        reminded.add(key);
        if (left < (mark - 5) * 60_000 && mark === 60) continue;
        const msg = `${name} updates in ${countdown(left)}`;
        toast(msg, { description: u.announcement_title || 'Scheduled update' });
        if (isDesktop && usePrefs.getState().desktopNotifications) invoke('desktop_notify', { title: 'Update reminder', body: msg }).catch(() => {});
      }
    }
  }
}

export function startBackgroundJobs() {
  stopBackgroundJobs();
  window.setTimeout(() => collectSnapshots(), 8_000);
  collectorTimer = window.setInterval(() => collectSnapshots(), 15 * 60_000);
  reminderTimer = window.setInterval(checkReminders, 30_000);
}

export function stopBackgroundJobs() {
  window.clearInterval(collectorTimer);
  window.clearInterval(reminderTimer);
}
