// Bridge to the Rust side (src-tauri/src/commands.rs). In a plain browser (vite dev
// without Tauri) these calls reject with a clear message instead of crashing.
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop) throw new Error('This needs the Corel desktop app.');
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (e) {
    throw new Error(typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));
  }
}

export async function listen<T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  if (!isDesktop) return () => {};
  return tauriListen<T>(event, (e) => cb(e.payload));
}

/** URL for an image stored by the local engine (served by the timg:// protocol). */
export function engineImage(name?: string | null): string | undefined {
  if (!name) return undefined;
  return `http://timg.localhost/${encodeURIComponent(name)}`;
}

export async function openExternal(url: string) {
  if (isDesktop) await invoke('open_external', { url });
  else window.open(url, '_blank', 'noopener');
}

export interface AppInfo {
  version: string;
  machine: string;
  dataDir: string;
  updateReady: string | null;
  installed: boolean;
  signinAvailable: boolean;
  migratedFromRoicon: boolean;
  startedHidden: boolean;
}

export async function appInfo(): Promise<AppInfo> {
  if (!isDesktop)
    return { version: '2.0.0', machine: 'Browser preview', dataDir: '', updateReady: null, installed: false, signinAvailable: false, migratedFromRoicon: false, startedHidden: false };
  return invoke<AppInfo>('app_info');
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.readAsDataURL(file);
  });
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function saveTextFile(defaultName: string, contents: string): Promise<string | null> {
  if (isDesktop) return invoke<string | null>('save_text_file', { defaultName, contents });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  a.download = defaultName;
  a.click();
  return defaultName;
}
