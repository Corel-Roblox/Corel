// Who is online and what they are looking at, via a private Supabase Realtime
// presence channel ("team:<id>", members only; see realtime.messages policies).
// Script editors also broadcast on "team:<id>:script:<scriptId>" (see ScriptEditor).
import { createWithEqualityFn as create } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';

export interface PresenceInfo {
  user_id: string;
  route: string;
  project_id?: string | null;
  editing?: string | null;
  online_at: string;
}

interface PresenceState {
  online: Record<string, PresenceInfo>;
  me: Omit<PresenceInfo, 'user_id' | 'online_at'>;
  start: (teamId: string, userId: string) => void;
  stop: () => void;
  update: (patch: Partial<Omit<PresenceInfo, 'user_id' | 'online_at'>>) => void;
}

let channel: RealtimeChannel | null = null;
let heartbeat: number | undefined;
let current: { teamId: string; userId: string } | null = null;

export const usePresence = create<PresenceState>()((set, get) => ({
  online: {},
  me: { route: '/', project_id: null, editing: null },
  start: (teamId, userId) => {
    const supabase = getSupabase();
    if (!supabase) return;
    if (current?.teamId === teamId && current.userId === userId && channel) return;
    get().stop();
    current = { teamId, userId };
    const ch = supabase.channel(`team:${teamId}`, { config: { private: true, presence: { key: userId } } });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<PresenceInfo>();
      const online: Record<string, PresenceInfo> = {};
      for (const [key, metas] of Object.entries(state)) {
        const latest = metas[metas.length - 1];
        if (latest) online[key] = { ...latest, user_id: key };
      }
      set({ online });
    });
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await ch.track({ ...get().me, online_at: new Date().toISOString() });
    });
    channel = ch;
    const beat = () => supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', userId).then(() => {});
    beat();
    heartbeat = window.setInterval(beat, 120_000);
  },
  stop: () => {
    const supabase = getSupabase();
    if (channel && supabase) supabase.removeChannel(channel);
    channel = null;
    current = null;
    window.clearInterval(heartbeat);
    set({ online: {} });
  },
  update: (patch) => {
    const me = { ...get().me, ...patch };
    set({ me });
    channel?.track({ ...me, online_at: new Date().toISOString() });
  },
}), shallow);

export const useIsOnline = (userId: string | null | undefined) => usePresence((s) => (userId ? !!s.online[userId] : false));
