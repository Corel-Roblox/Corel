import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Bell, Database, Download, ExternalLink, FolderOpen, Info, Keyboard, KeyRound, Laptop, Loader2, LogOut, Monitor, Moon, Palette, Plug, RefreshCw, Shield, ShieldCheck, Sun, Trash2, User, Users } from 'lucide-react';
import { Avatar, Badge, Button, Card, Field, Input, Notice, Segmented, Switch, Textarea, confirm } from '@/components/ui';
import { ShortcutList } from '@/components/layout/ShortcutsDialog';
import { TeamSettingsTab } from './Team';
import { ACCENTS, usePrefs } from '@/store/prefs';
import { useSession } from '@/store/session';
import { useEngine } from '@/store/engine';
import { useUI } from '@/store/ui';
import { displayName, useWorkspace } from '@/store/workspace';
import { backendConfig, clearCustomBackend, getSupabase, must, saveCustomBackend, sb, testBackend } from '@/lib/supabase';
import { engineImage, invoke, isDesktop, openExternal, pickFile, saveTextFile } from '@/lib/tauri';
import { uploadPublicImage } from '@/lib/actions';
import { cn } from '@/lib/format';

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: Palette, account: false },
  { id: 'profile', label: 'Profile', icon: User, account: true },
  { id: 'security', label: 'Account security', icon: Shield, account: true },
  { id: 'team', label: 'Team settings', icon: Users, account: true },
  { id: 'notifications', label: 'Notifications', icon: Bell, account: false },
  { id: 'integrations', label: 'Integrations', icon: Plug, account: false },
  { id: 'desktop', label: 'Desktop app', icon: Laptop, account: false },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, account: false },
  { id: 'data', label: 'Data management', icon: Database, account: false },
  { id: 'about', label: 'About', icon: Info, account: false },
] as const;

export function SettingsPage() {
  const { section = 'appearance' } = useParams();
  const navigate = useNavigate();
  const offline = useUI((s) => s.offline);
  const sections = SECTIONS.filter((s) => !offline || !s.account);
  const current = sections.find((s) => s.id === section) ?? sections[0];
  return (
    <div className="flex h-full">
      <nav className="w-[220px] shrink-0 border-r border-line bg-sunken/40 px-2 pt-5" aria-label="Settings sections">
        <h1 className="px-2 pb-3 text-[15px] font-semibold">Settings</h1>
        {sections.map((s) => (
          <button key={s.id} onClick={() => navigate(`/settings/${s.id}`)} className={cn('flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] transition-colors', current.id === s.id ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg')}>
            <s.icon className={cn('size-4', current.id === s.id ? 'text-accent-text' : 'text-fg-subtle')} />
            {s.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div key={current.id} className="mx-auto max-w-[720px] px-8 pb-16 pt-6 animate-fade-in">
          <h2 className="mb-5 text-[19px] font-semibold tracking-[-0.02em]">{current.label}</h2>
          {current.id === 'appearance' && <Appearance />}
          {current.id === 'profile' && <Profile />}
          {current.id === 'security' && <Security />}
          {current.id === 'team' && <TeamSettingsTab />}
          {current.id === 'notifications' && <Notifications />}
          {current.id === 'integrations' && <Integrations />}
          {current.id === 'desktop' && <DesktopSettings />}
          {current.id === 'shortcuts' && <Card><ShortcutList /></Card>}
          {current.id === 'data' && <DataManagement />}
          {current.id === 'about' && <About />}
        </div>
      </div>
    </div>
  );
}

function Row({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-6 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{title}</p>
        {description && <p className="mt-0.5 text-[12px] text-fg-subtle">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Appearance() {
  const p = usePrefs();
  return (
    <Card padded={false}>
      <div className="divide-y divide-line px-4">
        <Row title="Theme" description="Dark is the default. System follows Windows.">
          <Segmented label="Theme" value={p.theme} onChange={(theme) => p.set({ theme })} options={[{ value: 'dark', label: 'Dark', icon: <Moon className="size-3" /> }, { value: 'light', label: 'Light', icon: <Sun className="size-3" /> }, { value: 'system', label: 'System', icon: <Monitor className="size-3" /> }]} />
        </Row>
        <Row title="Accent colour" description="Used for buttons, highlights and charts.">
          <div className="flex gap-1.5" role="radiogroup" aria-label="Accent colour">
            {ACCENTS.map((a) => (
              <button key={a.id} role="radio" aria-checked={p.accent === a.id} aria-label={a.label} title={a.label} onClick={() => p.set({ accent: a.id })} className={cn('size-6 rounded-full ring-offset-2 ring-offset-panel transition-transform hover:scale-110', p.accent === a.id && 'ring-2 ring-fg')} style={{ background: a.swatch }} />
            ))}
          </div>
        </Row>
        <Row title="Interface size" description="Also Ctrl + / Ctrl − / Ctrl 0.">
          <Segmented label="Interface size" value={String(p.scale)} onChange={(v) => p.set({ scale: Number(v) })} options={[{ value: '0.9', label: '90%' }, { value: '1', label: '100%' }, { value: '1.1', label: '110%' }, { value: '1.2', label: '120%' }]} />
        </Row>
        <Row title="Reduce motion" description="Turns off transitions and animations. Windows’ own setting is always respected.">
          <Switch checked={p.reduceMotion} label="Reduce motion" onChange={(reduceMotion) => p.set({ reduceMotion })} />
        </Row>
        <Row title="Collapsed sidebar" description="Ctrl + B toggles it anywhere.">
          <Switch checked={p.sidebarCollapsed} label="Collapsed sidebar" onChange={(sidebarCollapsed) => p.set({ sidebarCollapsed })} />
        </Row>
      </div>
    </Card>
  );
}

function Profile() {
  const profile = useSession((s) => s.profile);
  const user = useSession((s) => s.user);
  const update = useSession((s) => s.updateProfile);
  const [form, setForm] = useState({ display_name: '', username: '', roblox_username: '', bio: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (profile) setForm({ display_name: profile.display_name, username: profile.username ?? '', roblox_username: profile.roblox_username ?? '', bio: profile.bio });
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!profile) return <Loader2 className="size-4 animate-spin" />;
  const save = async () => {
    setError(null);
    if (form.username && !/^[a-z0-9_.-]{2,32}$/.test(form.username)) return setError('Usernames use 2–32 lowercase letters, numbers, dots, dashes or underscores.');
    setSaving(true);
    try {
      await update({ display_name: form.display_name.trim(), username: form.username || null, roblox_username: form.roblox_username.trim() || null, bio: form.bio });
      toast.success('Profile saved');
    } catch (e) {
      setError((e as Error).message === 'That already exists.' ? 'That username is taken.' : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Avatar name={displayName(profile)} url={profile.avatar_url} id={profile.id} size={56} />
          <div className="flex gap-2">
            <Button size="sm" onClick={async () => { const f = await pickFile('image/png,image/jpeg,image/webp'); if (!f) return; try { const url = await uploadPublicImage('avatars', user!.id, f); await update({ avatar_url: url }); toast.success('Avatar updated'); } catch (e) { toast.error((e as Error).message); } }}>Upload avatar</Button>
            {profile.avatar_url && <Button size="sm" variant="ghost" onClick={() => update({ avatar_url: null })}>Remove</Button>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Display name"><Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} maxLength={60} /></Field>
          <Field label="Username" optional><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} placeholder="alex" /></Field>
          <Field label="Roblox username" optional hint="Shown to teammates."><Input value={form.roblox_username} onChange={(e) => setForm({ ...form, roblox_username: e.target.value })} /></Field>
          <Field label="Email" hint="Change it under Account security."><Input value={user?.email ?? ''} disabled /></Field>
        </div>
        <Field label="About you" optional><Textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="Scripter, builder, UI…" rows={3} /></Field>
        {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
        <div className="flex justify-end"><Button variant="primary" loading={saving} onClick={save}>Save profile</Button></div>
      </div>
    </Card>
  );
}

function Security() {
  const user = useSession((s) => s.user);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [mfa, setMfa] = useState<{ id: string; status: string }[] | null>(null);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const loadMfa = async () => {
    const { data } = await sb().auth.mfa.listFactors();
    setMfa((data?.totp ?? []).map((f) => ({ id: f.id, status: f.status })));
  };
  useEffect(() => {
    loadMfa();
  }, []);
  const run = async (key: string, f: () => Promise<void>) => {
    setBusy(key);
    try {
      await f();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const verified = mfa?.find((f) => f.status === 'verified');
  return (
    <div className="space-y-3">
      <Card title="Email">
        <div className="flex gap-2">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={user?.email} aria-label="New email" />
          <Button loading={busy === 'email'} disabled={!email.trim()} onClick={() => run('email', async () => { const { error } = await sb().auth.updateUser({ email: email.trim() }); if (error) throw error; toast.success('Check both inboxes to confirm the change.'); setEmail(''); })}>Change email</Button>
        </div>
      </Card>
      <Card title="Password">
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <Field label="New password" hint="At least 8 characters."><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Repeat"><Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" invalid={!!pw2 && pw !== pw2} /></Field>
          <Button loading={busy === 'pw'} disabled={pw.length < 8 || pw !== pw2} onClick={() => run('pw', async () => { const { error } = await sb().auth.updateUser({ password: pw }); if (error) throw error; setPw(''); setPw2(''); toast.success('Password changed'); })}>Update</Button>
        </div>
      </Card>
      <Card title="Two-factor authentication" description="Use an authenticator app for a code at sign-in.">
        {mfa === null ? <Loader2 className="size-4 animate-spin" /> : verified ? (
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-5 text-success" />
            <span className="flex-1 text-[13px]">Authenticator app is on.</span>
            <Button variant="danger" size="sm" loading={busy === 'unenroll'} onClick={async () => { if (await confirm({ title: 'Turn off two-factor authentication?', body: 'Your account will be protected by your password only.', danger: true, confirm: 'Turn off' })) run('unenroll', async () => { const { error } = await sb().auth.mfa.unenroll({ factorId: verified.id }); if (error) throw error; await loadMfa(); toast.success('Two-factor authentication turned off'); }); }}>Turn off</Button>
          </div>
        ) : enroll ? (
          <div className="flex gap-4">
            <img src={enroll.qr} alt="Scan with your authenticator app" className="size-[150px] rounded-lg bg-white p-2" />
            <div className="flex-1 space-y-3">
              <p className="text-[12.5px] text-fg-muted">Scan the code with your authenticator app, or enter this key: <code className="selectable font-mono text-fg">{enroll.secret}</code></p>
              <Field label="6-digit code"><Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className="w-[140px] font-mono tracking-widest" autoFocus /></Field>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => { sb().auth.mfa.unenroll({ factorId: enroll.id }); setEnroll(null); }}>Cancel</Button>
                <Button variant="primary" disabled={code.length !== 6} loading={busy === 'verify'} onClick={() => run('verify', async () => { const { error } = await sb().auth.mfa.challengeAndVerify({ factorId: enroll.id, code }); if (error) throw error; setEnroll(null); setCode(''); await loadMfa(); toast.success('Two-factor authentication is on'); })}>Verify and turn on</Button>
              </div>
            </div>
          </div>
        ) : (
          <Button loading={busy === 'enroll'} icon={<KeyRound className="size-3.5" />} onClick={() => run('enroll', async () => { for (const f of mfa.filter((x) => x.status !== 'verified')) await sb().auth.mfa.unenroll({ factorId: f.id }); const { data, error } = await sb().auth.mfa.enroll({ factorType: 'totp', friendlyName: `Corel ${Date.now()}` }); if (error) throw error; setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret }); })}>Set up authenticator app</Button>
        )}
      </Card>
      <Card title="Sessions">
        <div className="flex flex-wrap gap-2">
          <Button icon={<LogOut className="size-3.5" />} loading={busy === 'others'} onClick={() => run('others', async () => { await useSession.getState().signOut('others'); toast.success('Signed out on all other devices'); })}>Sign out other devices</Button>
          <Button variant="ghost" icon={<LogOut className="size-3.5" />} onClick={() => useSession.getState().signOut()}>Sign out here</Button>
        </div>
      </Card>
      <Card title="Delete account">
        <p className="mb-3 text-[12.5px] text-fg-muted">Removes your account and any team you own alone. If you own a team with other members, transfer ownership first. Your comments and past activity in other teams remain, attributed to a former member.</p>
        <Button variant="danger" icon={<Trash2 className="size-3.5" />} onClick={async () => { if (await confirm({ title: 'Delete your Corel account?', body: 'This cannot be undone.', danger: true, confirm: 'Delete account', typeToConfirm: 'delete my account' })) run('delete', async () => { must(await sb().rpc('delete_my_account')); await useSession.getState().signOut(); navigate('/'); }); }}>Delete my account</Button>
      </Card>
    </div>
  );
}

const NOTIF_KINDS = [
  { key: 'bug_assigned', label: 'Bug assignments', description: 'Someone assigns a bug to you' },
  { key: 'bug_update', label: 'Bug status changes', description: 'A bug you reported changes status' },
  { key: 'comment', label: 'New comments', description: 'Comments on bugs and tasks you’re involved in' },
  { key: 'invite', label: 'Team invitations', description: 'You’re invited to a team' },
  { key: 'project_change', label: 'Project changes', description: 'Projects you created or were added to change' },
  { key: 'task_update', label: 'Task updates', description: 'Tasks assigned to you, or yours being completed' },
  { key: 'script_edit', label: 'Script edits', description: 'Someone edits a script you created' },
  { key: 'publish', label: 'Publishing', description: 'An update is scheduled in your team' },
];

function Notifications() {
  const profile = useSession((s) => s.profile);
  const offline = useUI((s) => s.offline);
  const update = useSession((s) => s.updateProfile);
  const p = usePrefs();
  const prefs = profile?.notification_prefs ?? {};
  return (
    <div className="space-y-3">
      <Card padded={false}>
        <div className="divide-y divide-line px-4">
          <Row title="Desktop notifications" description="Show a Windows notification when Corel isn’t focused.">
            <Switch checked={p.desktopNotifications} label="Desktop notifications" onChange={(desktopNotifications) => p.set({ desktopNotifications })} />
          </Row>
          <Row title="Publishing reminders" description="Remind me 1 hour and 10 minutes before a scheduled update.">
            <Switch checked={p.publishReminders} label="Publishing reminders" onChange={(publishReminders) => p.set({ publishReminders })} />
          </Row>
        </div>
      </Card>
      {!offline && profile && (
        <Card title="What to notify me about" description="Synced to your account, so it applies on every device." padded={false}>
          <div className="divide-y divide-line px-4">
            {NOTIF_KINDS.map((k) => (
              <Row key={k.key} title={k.label} description={k.description}>
                <Switch checked={prefs[k.key] !== false} label={k.label} onChange={(v) => update({ notification_prefs: { ...prefs, [k.key]: v } }).catch((e) => toast.error(e.message))} />
              </Row>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Integrations() {
  const state = useEngine((s) => s.state);
  const info = useEngine((s) => s.info);
  const [busy, setBusy] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const run = async (k: string, f: () => Promise<unknown>, ok?: string) => {
    setBusy(k);
    try {
      await f();
      if (ok) toast.success(ok);
    } catch (e) {
      const m = (e as Error).message;
      if (m !== 'cancelled') toast.error(m);
    } finally {
      setBusy(null);
    }
  };
  const acct = state?.account;
  return (
    <div className="space-y-3">
      <Card title="Roblox" description="Used to upload icons, read moderation status and switch place icons. Tokens are stored in Windows Credential Manager and never leave this PC.">
        {!isDesktop ? <Notice>Roblox connection is managed by the desktop app.</Notice> : state?.hasCredential ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {acct?.avatar ? <img src={engineImage(acct.avatar)} alt="" className="size-10 rounded-full" /> : <Avatar name={acct?.display_name || acct?.name || 'Roblox'} size={40} />}
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">{acct?.display_name || acct?.name || acct?.key_name || 'Connected'}</p>
                <p className="text-[12px] text-fg-subtle">{state.usesOauth ? `Signed in with Roblox${acct?.name ? ` as @${acct.name}` : ''}` : `Open Cloud API key${acct?.key_name ? ` “${acct.key_name}”` : ''}`}</p>
              </div>
              <Badge tone="success"><ShieldCheck className="size-3" />Connected</Badge>
            </div>
            {acct?.granted && acct.granted.length > 0 && (
              <div>
                <p className="mb-1.5 text-[12px] text-fg-muted">Access granted to</p>
                <div className="flex flex-wrap gap-2">{acct.granted.map((g) => <Badge key={g.id}>{g.kind === 'Group' ? 'Group' : 'User'} · {g.name}</Badge>)}</div>
              </div>
            )}
            <div className="flex gap-2">
              {state.usesOauth ? (
                <>
                  <Button icon={<RefreshCw className="size-3.5" />} loading={busy === 'signin'} disabled={!info?.signinAvailable} onClick={() => run('signin', () => invoke('roblox_sign_in'), 'Reconnected')}>Reconnect / change groups</Button>
                  <Button variant="ghost" loading={busy === 'out'} onClick={() => run('out', () => invoke('roblox_sign_out'), 'Disconnected from Roblox')}>Disconnect</Button>
                </>
              ) : (
                <Button variant="ghost" onClick={() => run('clear', () => invoke('roblox_clear_api_key'), 'API key removed')}>Remove API key</Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {acct?.method === 'expired' && <Notice tone="warning">Your Roblox sign-in expired. Connect again to keep scheduled updates working.</Notice>}
            {busy === 'signin' ? (
              <div className="flex items-center gap-3 rounded-lg border border-line bg-raised p-3">
                <Loader2 className="size-4 animate-spin text-accent-text" />
                <span className="flex-1 text-[13px]">Finish signing in on the Roblox page in your browser. Choose your account and any groups that own your games.</span>
                <Button size="sm" variant="ghost" onClick={() => invoke('roblox_cancel_sign_in')}>Cancel</Button>
              </div>
            ) : (
              <Button variant="primary" disabled={!info?.signinAvailable} onClick={() => run('signin', () => invoke('roblox_sign_in'), 'Connected to Roblox')}>Connect with Roblox</Button>
            )}
            {!info?.signinAvailable && <p className="text-[12px] text-fg-subtle">Sign in with Roblox isn’t available in this build. Use an Open Cloud API key instead.</p>}
            <button className="text-[12.5px] text-fg-muted hover:text-fg" onClick={() => setShowKey(!showKey)}>{showKey ? 'Hide' : 'Use an Open Cloud API key instead'}</button>
            {showKey && (
              <div className="space-y-2">
                <Field label="Open Cloud API key" hint={<>Create one in Creator Hub → Open Cloud → API Keys with the <b>Assets API</b> (read + write) for your experiences.</>}>
                  <div className="flex gap-2">
                    <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} className="font-mono" autoComplete="off" />
                    <Button loading={busy === 'key'} disabled={key.length < 20} onClick={() => run('key', async () => { await invoke('roblox_set_api_key', { key }); setKey(''); }, 'API key saved')}>Save key</Button>
                  </div>
                </Field>
                <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => openExternal('https://create.roblox.com/dashboard/credentials')}>Open Creator Hub credentials</Button>
              </div>
            )}
          </div>
        )}
      </Card>
      <BackendCard />
    </div>
  );
}

function BackendCard() {
  const cfg = backendConfig();
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(cfg?.url ?? '');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Workspace server" description="Where your team’s shared projects live (Supabase). Only the public anon key is stored here; access is enforced by the server.">
      {cfg ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Database className="size-4 text-fg-subtle" />
            <span className="flex-1 truncate font-mono text-[12px] text-fg-muted">{cfg.url}</span>
            <Badge tone={cfg.source === 'build' ? 'neutral' : 'info'}>{cfg.source === 'build' ? 'Built in' : 'Custom'}</Badge>
          </div>
          {!editing ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setEditing(true)}>Use a different server</Button>
              {cfg.source === 'custom' && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: 'Switch back to the built-in server?', body: 'You will be signed out.', confirm: 'Switch' })) { await getSupabase()?.auth.signOut(); clearCustomBackend(); window.location.reload(); } }}>Use built-in server</Button>}
            </div>
          ) : (
            <div className="space-y-2">
              <Field label="Project URL"><Input value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
              <Field label="Publishable key (or legacy anon key)"><Input value={key} onChange={(e) => setKey(e.target.value)} className="font-mono text-[12px]" /></Field>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                <Button variant="primary" loading={busy} disabled={!url || !key} onClick={async () => { setBusy(true); try { await testBackend(url, key); await getSupabase()?.auth.signOut(); saveCustomBackend(url, key); window.location.reload(); } catch (e) { toast.error((e as Error).message); setBusy(false); } }}>Test and switch</Button>
              </div>
            </div>
          )}
        </div>
      ) : <Notice>No workspace server is configured. Collaboration features are off.</Notice>}
    </Card>
  );
}

function DesktopSettings() {
  const state = useEngine((s) => s.state);
  if (!isDesktop || !state) return <Notice>These settings are part of the desktop app.</Notice>;
  const s = state.settings;
  const set = (patch: Record<string, boolean>) => invoke('engine_set_settings', { patch }).catch((e) => toast.error(e.message));
  return (
    <Card padded={false}>
      <div className="divide-y divide-line px-4">
        <Row title="Start with Windows" description="Runs quietly in the tray so scheduled icon updates happen on time."><Switch checked={s.launch_at_login} label="Start with Windows" onChange={(v) => set({ launchAtLogin: v })} /></Row>
        <Row title="Keep running when closed" description="Closing the window keeps Corel in the system tray."><Switch checked={s.close_to_tray} label="Keep running when closed" onChange={(v) => set({ closeToTray: v })} /></Row>
        <Row title="Publishing notifications" description="Windows notifications when countdown steps go live or an update finishes."><Switch checked={s.notifications} label="Publishing notifications" onChange={(v) => set({ notifications: v })} /></Row>
        <Row title="24-hour clock" description="Show 18:00 instead of 6:00 PM in Publish."><Switch checked={s.use_24h} label="24-hour clock" onChange={(v) => set({ use24h: v })} /></Row>
        <Row title="Automatic updates" description="Download new Corel versions in the background."><Switch checked={s.auto_update} label="Automatic updates" onChange={(v) => set({ autoUpdate: v })} /></Row>
      </div>
    </Card>
  );
}

function DataManagement() {
  const ws = useWorkspace();
  const team = ws.teams.find((t) => t.id === ws.teamId);
  const info = useEngine((s) => s.info);
  const offline = useUI((s) => s.offline);
  const [busy, setBusy] = useState(false);
  const exportTeam = async () => {
    setBusy(true);
    try {
      const supabase = sb();
      const [comments, versions, metrics] = await Promise.all([
        supabase.from('comments').select('*').eq('team_id', ws.teamId!),
        supabase.from('script_versions').select('*').eq('team_id', ws.teamId!),
        supabase.from('analytics_metrics').select('*').eq('team_id', ws.teamId!),
      ]);
      const data = { exportedAt: new Date().toISOString(), team, members: ws.members.map((m) => ({ ...m, profile: ws.profiles[m.user_id] })), projects: ws.projects, projectMembers: ws.projectMembers, tasks: ws.tasks, bugs: ws.bugs, comments: comments.data, scripts: ws.scripts, scriptVersions: versions.data, folders: ws.folders, publishUpdates: ws.publish, analyticsMetrics: metrics.data, activity: ws.activity };
      const path = await saveTextFile(`corel-${(team?.name ?? 'team').replace(/\W+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
      if (path) toast.success('Workspace exported', { description: path });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      {!offline && (
        <Card title="Export workspace" description="Download everything in this team as JSON: projects, tasks, bugs, comments, scripts with all versions, publishing history and imported analytics.">
          <Button icon={<Download className="size-3.5" />} loading={busy} onClick={exportTeam}>Export {team?.name}</Button>
        </Card>
      )}
      {isDesktop && (
        <Card title="Local data" description="Publishing schedules and icon images live on this PC. Your sign-in is encrypted with your Windows account.">
          <div className="space-y-3">
            <p className="selectable font-mono text-[12px] text-fg-muted">{info?.dataDir}</p>
            {info?.migratedFromRoicon && <Notice tone="success">Your experiences and schedules from Roicon were imported automatically. The old Roicon folder was left untouched.</Notice>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<FolderOpen className="size-3.5" />} onClick={() => invoke('reveal_data_dir')}>Open folder</Button>
              <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: 'Clear cached previews and drafts?', body: 'Unsaved script drafts on this PC are discarded. Nothing in your workspace is affected.', confirm: 'Clear' })) { Object.keys(localStorage).filter((k) => k.startsWith('corel.draft.')).forEach((k) => localStorage.removeItem(k)); toast.success('Local cache cleared'); } }}>Clear local cache</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function About() {
  const info = useEngine((s) => s.info);
  return (
    <Card>
      <div className="space-y-2 text-[13px] text-fg-muted">
        <p><span className="font-semibold text-fg">Corel</span> {info?.version}: the workspace for Roblox development teams.</p>
        <p>Publishing, analytics, bug tracking, a shared Luau library and real-time collaboration in one desktop app.</p>
        <p className="text-[12px] text-fg-subtle">Collaboration in Corel is separate from Roblox Studio’s Team Create; Corel does not edit places in Studio.</p>
        {info?.updateReady && <Button variant="primary" size="sm" onClick={() => invoke('restart_for_update')}>Restart to install {info.updateReady}</Button>}
      </div>
    </Card>
  );
}
