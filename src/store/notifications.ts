import { createWithEqualityFn as create } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';
import { invoke, isDesktop } from '@/lib/tauri';
import type { Notification } from '@/lib/types';
import { usePrefs } from './prefs';

interface NotificationsState {
  items: Notification[];
  loaded: boolean;
  start: (userId: string) => Promise<void>;
  stop: () => void;
  markRead: (ids?: number[]) => Promise<void>;
  remove: (id: number) => Promise<void>;
  clearRead: () => Promise<void>;
}

let channel: RealtimeChannel | null = null;

export const useNotifications = create<NotificationsState>()((set, get) => ({
  items: [],
  loaded: false,
  start: async (userId) => {
    const supabase = getSupabase();
    if (!supabase) return;
    get().stop();
    const { data } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100);
    set({ items: (data as Notification[]) || [], loaded: true });
    channel = supabase
      .channel(`db:notifications:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (p) => {
        if (p.eventType === 'INSERT') {
          const n = p.new as Notification;
          set({ items: [n, ...get().items.filter((x) => x.id !== n.id)].slice(0, 200) });
          toast(n.title, { description: n.body || undefined });
          if (isDesktop && usePrefs.getState().desktopNotifications && (document.hidden || !document.hasFocus())) {
            invoke('desktop_notify', { title: n.title, body: n.body }).catch(() => {});
          }
        } else if (p.eventType === 'UPDATE') {
          const n = p.new as Notification;
          set({ items: get().items.map((x) => (x.id === n.id ? n : x)) });
        } else if (p.eventType === 'DELETE') {
          set({ items: get().items.filter((x) => x.id !== (p.old as Notification).id) });
        }
      })
      .subscribe();
  },
  stop: () => {
    if (channel) getSupabase()?.removeChannel(channel);
    channel = null;
  },
  markRead: async (ids) => {
    const supabase = getSupabase();
    if (!supabase) return;
    const target = ids ?? get().items.filter((n) => !n.read_at).map((n) => n.id);
    if (!target.length) return;
    const now = new Date().toISOString();
    set({ items: get().items.map((n) => (target.includes(n.id) ? { ...n, read_at: n.read_at ?? now } : n)) });
    await supabase.from('notifications').update({ read_at: now }).in('id', target);
  },
  remove: async (id) => {
    set({ items: get().items.filter((n) => n.id !== id) });
    await getSupabase()?.from('notifications').delete().eq('id', id);
  },
  clearRead: async () => {
    const ids = get().items.filter((n) => n.read_at).map((n) => n.id);
    set({ items: get().items.filter((n) => !n.read_at) });
    if (ids.length) await getSupabase()?.from('notifications').delete().in('id', ids);
  },
}), shallow);
