import { useState } from 'react';
import { Database, ExternalLink, WifiOff } from 'lucide-react';
import { Button, Field, Input, Notice } from '@/components/ui';
import { AuthLayout } from './Auth';
import { saveCustomBackend, testBackend } from '@/lib/supabase';
import { isDesktop, openExternal } from '@/lib/tauri';
import { useUI } from '@/store/ui';

/** Shown when this build has no workspace backend configured (self-hosted setups). */
export function BackendSetup() {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await testBackend(url, key);
      saveCustomBackend(url, key);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      footer={
        isDesktop && (
          <button className="inline-flex items-center gap-1.5 hover:text-fg" onClick={() => useUI.getState().set({ offline: true })}>
            <WifiOff className="size-3" /> Continue without a workspace (icon publishing only)
          </button>
        )
      }
    >
      <h1 className="text-center text-[19px] font-semibold tracking-[-0.02em]">Connect a workspace server</h1>
      <p className="mt-1 text-center text-[13px] text-fg-muted">Corel stores shared projects on a Supabase project you control.</p>
      <div className="mt-6 space-y-4 rounded-xl border border-line bg-panel p-5">
        <Notice tone="neutral" icon={<Database />}>
          Create a free project at supabase.com, run <code className="font-mono text-fg">supabase/migrations</code> from the Corel source, then paste the Project URL and the <b className="text-fg">publishable</b> key (Project Settings → API Keys). Never paste a secret or service_role key.
        </Notice>
        <Field label="Project URL"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://abcd1234.supabase.co" autoFocus /></Field>
        <Field label="Publishable key (or legacy anon key)"><Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="sb_publishable_… or eyJhbGciOi…" className="font-mono text-[12px]" /></Field>
        {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
        <Button variant="primary" className="w-full" loading={busy} disabled={!url || !key} onClick={connect}>Test and connect</Button>
        <Button variant="ghost" className="w-full" icon={<ExternalLink className="size-3.5" />} onClick={() => openExternal('https://supabase.com/dashboard/projects')}>Open Supabase dashboard</Button>
      </div>
    </AuthLayout>
  );
}
