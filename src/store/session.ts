import { createWithEqualityFn as create } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import type { User } from '@supabase/supabase-js';
import { getSupabase, must } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

type Status = 'loading' | 'no-backend' | 'signed-out' | 'signed-in';

interface Session {
  status: Status;
  user: User | null;
  profile: Profile | null;
  recovery: boolean;
  init: () => void;
  loadProfile: () => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  signOut: (scope?: 'local' | 'others' | 'global') => Promise<void>;
  setRecovery: (v: boolean) => void;
}

let started = false;

export const useSession = create<Session>()((set, get) => ({
  status: 'loading',
  user: null,
  profile: null,
  recovery: false,
  init: () => {
    if (started) return;
    started = true;
    const supabase = getSupabase();
    if (!supabase) {
      set({ status: 'no-backend' });
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user ?? null;
      set({ user, status: user ? 'signed-in' : 'signed-out' });
      if (user) get().loadProfile();
    });
    supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user ?? null;
      if (event === 'PASSWORD_RECOVERY') set({ recovery: true });
      const prev = get().user;
      set({ user, status: user ? 'signed-in' : 'signed-out' });
      if (user && user.id !== prev?.id) get().loadProfile();
      if (!user) set({ profile: null });
    });
  },
  loadProfile: async () => {
    const supabase = getSupabase();
    const uid = get().user?.id;
    if (!supabase || !uid) return;
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (data) set({ profile: data as unknown as Profile });
  },
  updateProfile: async (patch) => {
    const supabase = getSupabase()!;
    const uid = get().user!.id;
    const row = must(await supabase.from('profiles').update(patch).eq('id', uid).select().single());
    set({ profile: row as unknown as Profile });
  },
  signOut: async (scope = 'local') => {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.auth.signOut({ scope });
    if (scope !== 'others') set({ user: null, profile: null, status: 'signed-out' });
  },
  setRecovery: (v) => set({ recovery: v }),
}), shallow);

export const useUserId = () => useSession((s) => s.user?.id ?? '');
