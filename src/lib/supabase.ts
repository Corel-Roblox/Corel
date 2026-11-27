// Workspace backend client. The URL and anon key are public by design: access is
// enforced by row level security in supabase/migrations. Release builds bake them in
// (COREL_PUBLIC_SUPABASE_URL / _ANON_KEY); Settings → Integrations can override them
// for a self-hosted workspace. The session (access + refresh token) is stored
// encrypted with Windows DPAPI by the desktop app, not in browser storage.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { invoke, isDesktop } from './tauri';

export interface BackendConfig {
  url: string;
  anonKey: string;
  source: 'build' | 'custom';
}

const CUSTOM_KEY = 'corel.backend';

export function backendConfig(): BackendConfig | null {
  try {
    const custom = JSON.parse(localStorage.getItem(CUSTOM_KEY) || 'null');
    if (custom?.url && custom?.anonKey) return { url: custom.url, anonKey: custom.anonKey, source: 'custom' };
  } catch {
    /* ignore */
  }
  const url = import.meta.env.COREL_PUBLIC_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.COREL_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
  if (url && anonKey) return { url, anonKey, source: 'build' };
  return null;
}

export function saveCustomBackend(url: string, anonKey: string) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify({ url: url.trim().replace(/\/+$/, ''), anonKey: anonKey.trim() }));
}

export function clearCustomBackend() {
  localStorage.removeItem(CUSTOM_KEY);
}

/** Checks that a URL + key point at a reachable Supabase project with the Corel schema. */
export async function testBackend(url: string, anonKey: string): Promise<void> {
  const clean = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(clean)) throw new Error('The URL should start with https://');
  let res: Response;
  try {
    // New publishable keys (sb_publishable_...) are not JWTs, so they only go in the apikey header.
    const k = anonKey.trim();
    const headers: Record<string, string> = { apikey: k };
    if (k.startsWith('eyJ')) headers.Authorization = `Bearer ${k}`;
    if (k.startsWith('sb_secret_')) throw new Error('That is a secret key. Use the publishable (or anon) key instead.');
    res = await fetch(`${clean}/rest/v1/teams?select=id&limit=1`, { headers });
  } catch {
    throw new Error('Could not reach that server. Check the URL and your connection.');
  }
  if (res.status === 401) throw new Error('The server rejected the anon key.');
  if (res.status === 404) throw new Error('The Corel tables are missing. Run the migration in supabase/migrations first.');
  if (!res.ok && res.status !== 406) throw new Error(`The server answered ${res.status}.`);
}

const secureStorage = {
  async getItem(key: string) {
    if (!isDesktop) return localStorage.getItem(key);
    return (await invoke<string | null>('secure_get', { key })) ?? null;
  },
  async setItem(key: string, value: string) {
    if (!isDesktop) return localStorage.setItem(key, value);
    await invoke('secure_set', { key, value });
  },
  async removeItem(key: string) {
    if (!isDesktop) return localStorage.removeItem(key);
    await invoke('secure_remove', { key });
  },
};

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  const cfg = backendConfig();
  if (!cfg) return null;
  client = createClient(cfg.url, cfg.anonKey, {
    auth: { storage: secureStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'corel-auth' },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return client;
}

/** Throws a readable error for components that require the backend. */
export function sb(): SupabaseClient {
  const c = getSupabase();
  if (!c) throw new Error('The workspace backend is not configured.');
  return c;
}

/** Unwraps a Supabase response, turning PostgREST errors into readable messages. */
export function must<T>(res: { data: T | null; error: { message: string; code?: string; details?: string } | null }): T {
  if (res.error) throw new Error(friendlyError(res.error));
  return res.data as T;
}

export function friendlyError(e: { message: string; code?: string }): string {
  if (e.code === '42501' || /row-level security/i.test(e.message)) return 'You do not have permission to do that.';
  if (e.code === '23505') return 'That already exists.';
  if (/Failed to fetch|NetworkError/i.test(e.message)) return 'You appear to be offline. Changes were not saved.';
  return e.message;
}
