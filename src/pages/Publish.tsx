// Publish: the original Roicon engine (countdown icons that switch on a schedule),
// redesigned. Everything here calls the Rust scheduler; a step only shows as live
// after Roblox accepted the icon change for every selected place.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, CalendarClock, Check, CheckCircle2, Circle, Clock, Download, ExternalLink, Image as ImageIcon, Link2, Loader2, Megaphone, MoreHorizontal, Plus, QrCode, RefreshCw, Rocket, RotateCcw, ShieldCheck, Smartphone, Trash2, Upload, X, XCircle } from 'lucide-react';
import { Page } from '@/components/layout/Shell';
import { Badge, Button, Card, Dialog, EmptyState, Field, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Notice, PageHeader, Progress, Switch, Textarea, Tooltip, confirm } from '@/components/ui';
import { ProjectSelect, ProjectThumb, UserChip } from '@/components/common';
import { useNow } from '@/components/activity';
import { useEngine, STATUS_LABEL } from '@/store/engine';
import { useSession } from '@/store/session';
import { useUI } from '@/store/ui';
import { useWorkspace } from '@/store/workspace';
import { engineImage, fileToDataUrl, invoke, isDesktop, pickFile } from '@/lib/tauri';
import { cn, countdown, longDate, shortDate, timeAgo, toLocalInput } from '@/lib/format';
import type { EngineExperience, EngineStep, EngineTimer, PublishUpdate } from '@/lib/types';

const ACTIVE = ['preparing', 'scheduled', 'restoring'];

export function PublishPage() {
  const { expId } = useParams();
  const navigate = useNavigate();
  const state = useEngine((s) => s.state);
  const offline = useUI((s) => s.offline);
  const teamUpdates = useWorkspace((s) => s.publish);
  const [adding, setAdding] = useState(false);
  const exps = state?.experiences ?? [];
  const selected = exps.find((e) => e.id === expId) ?? exps[0];

  useEffect(() => {
    if (!expId && exps[0]) navigate(`/publish/${exps[0].id}`, { replace: true });
  }, [expId, exps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isDesktop) {
    return <Page><PageHeader title="Publish" /><Notice>Publishing runs in the Corel desktop app, because this PC uploads the icons and switches them on time.</Notice></Page>;
  }
  if (!state) return <Page><div className="flex justify-center py-20"><Loader2 className="size-5 animate-spin text-fg-subtle" /></div></Page>;

  const activeElsewhere = teamUpdates.filter((u) => ACTIVE.includes(u.status) && !exps.some((e) => e.update?.id === u.local_update_id));

  return (
    <div className="flex h-full">
      <aside className="flex w-[264px] shrink-0 flex-col border-r border-line bg-sunken/40">
        <div className="flex items-center justify-between px-4 pb-2 pt-5">
          <h1 className="text-[15px] font-semibold">Publish</h1>
          <Tooltip content="Add an experience"><IconButton label="Add experience" onClick={() => setAdding(true)}><Plus className="size-4" /></IconButton></Tooltip>
        </div>
        <RobloxStatus />
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {exps.length === 0 ? (
            <p className="px-2 py-4 text-[12.5px] text-fg-subtle">No experiences on this PC yet.</p>
          ) : (
            exps.map((e) => <ExperienceItem key={e.id} exp={e} active={selected?.id === e.id} onClick={() => navigate(`/publish/${e.id}`)} />)
          )}
          {!offline && activeElsewhere.length > 0 && (
            <div className="mt-4">
              <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">Running on teammates’ PCs</p>
              {activeElsewhere.map((u) => <RemoteUpdateItem key={u.id} u={u} />)}
            </div>
          )}
        </div>
        <div className="border-t border-line p-2"><PhoneRelayButton /></div>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {selected ? (
          <ExperienceView key={selected.id} exp={selected} />
        ) : (
          <div className="grid h-full place-items-center">
            <EmptyState icon={<Rocket />} title="Schedule your first icon update" body="Add a Roblox experience. Corel builds countdown icons (12h, 6h, 3h, 1h), uploads them early so they pass moderation, then switches your icon at each step and goes live with the new icon on time." action={<Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Add experience</Button>} />
          </div>
        )}
      </div>
      <AddExperienceDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function RobloxStatus() {
  const state = useEngine((s) => s.state);
  const navigate = useNavigate();
  if (state?.hasCredential) {
    const a = state.account;
    return (
      <button onClick={() => navigate('/settings/integrations')} className="mx-2 mb-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-fg-muted hover:bg-hover">
        <ShieldCheck className="size-3.5 text-success" />
        <span className="truncate">Roblox: {a?.display_name || a?.name || a?.key_name || (state.usesOauth ? 'signed in' : 'API key')}</span>
      </button>
    );
  }
  return (
    <div className="mx-3 mb-2">
      <Notice tone="warning" icon={<AlertTriangle />} action={<Button size="xs" variant="ghost" onClick={() => navigate('/settings/integrations')}>Connect</Button>}>
        {state?.account?.method === 'expired' ? 'Roblox sign-in expired.' : 'Connect Roblox to publish.'}
      </Notice>
    </div>
  );
}

function statusOf(e: EngineExperience, now: number): { label: string; tone: 'accent' | 'success' | 'neutral' | 'warning' | 'danger' } {
  const u = e.update;
  if (u && ACTIVE.includes(u.status)) {
    const err = u.steps.some((s) => s.apply === 'error' || s.upload === 'error');
    return { label: err ? 'Needs attention' : `${countdown(u.at - now)}`, tone: err ? 'danger' : 'accent' };
  }
  if (u?.status === 'done') return { label: 'Published', tone: 'success' };
  if (e.planned_at && e.new_icon) return { label: 'Ready', tone: 'neutral' };
  return { label: 'Not scheduled', tone: 'neutral' };
}

function ExperienceItem({ exp, active, onClick }: { exp: EngineExperience; active: boolean; onClick: () => void }) {
  const now = useNow(1000);
  const st = statusOf(exp, now);
  return (
    <button onClick={onClick} className={cn('flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors', active ? 'bg-active' : 'hover:bg-hover')}>
      {exp.current_icon ? <img src={engineImage(exp.current_icon)} alt="" className="size-9 rounded-md object-cover ring-1 ring-line" /> : <span className="grid size-9 place-items-center rounded-md bg-raised"><ImageIcon className="size-4 text-fg-subtle" /></span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{exp.name}</span>
        <span className={cn('tabular block truncate text-[11.5px]', st.tone === 'accent' ? 'text-accent-text' : st.tone === 'success' ? 'text-success' : st.tone === 'danger' ? 'text-danger' : 'text-fg-subtle')}>{st.label}</span>
      </span>
      {exp.update && ACTIVE.includes(exp.update.status) && <span className="live-dot size-1.5 rounded-full bg-accent" aria-label="Running" />}
    </button>
  );
}

function RemoteUpdateItem({ u }: { u: PublishUpdate }) {
  const project = useWorkspace((s) => s.projects.find((p) => p.id === u.project_id));
  const now = useNow(1000);
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate(`/projects/${u.project_id}/publish`)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-hover">
      <ProjectThumb project={project} size={28} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px]">{project?.name}</span>
        <span className="tabular block truncate text-[11.5px] text-fg-subtle">{countdown(new Date(u.update_at).getTime() - now)} · {u.machine}</span>
      </span>
    </button>
  );
}

// ------------------------------------------------------------------ experience view

function ExperienceView({ exp }: { exp: EngineExperience }) {
  const u = exp.update;
  const running = !!u && ACTIVE.includes(u.status);
  const signedIn = useSession((s) => s.status === 'signed-in');
  const offline = useUI((s) => s.offline);
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (key: string, f: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await f();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1080px] px-7 pb-12 pt-6 animate-fade-in">
      <div className="mb-5 flex items-start gap-4">
        {exp.current_icon ? <img src={engineImage(exp.current_icon)} alt="" className="size-14 rounded-lg object-cover ring-1 ring-line" /> : <span className="grid size-14 place-items-center rounded-lg bg-raised"><ImageIcon className="size-5 text-fg-subtle" /></span>}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[20px] font-semibold tracking-[-0.02em]">{exp.name}</h2>
          <p className="mt-0.5 text-[12px] text-fg-subtle">
            <span className="font-mono">Universe {exp.universe_id}</span> · {exp.places.filter((p) => p.enabled).length} of {exp.places.length} places · by {exp.creator.name || `${exp.creator.kind} ${exp.creator.id}`}
            {exp.playing > 0 && ` · ${exp.playing.toLocaleString()} playing`}
          </p>
        </div>
        {signedIn && !offline && (
          <div className="w-[220px]">
            <ProjectSelect label="Linked project" size="sm" value={exp.project_id ?? 'none'} onChange={(v) => act('link', () => invoke('exp_link', { id: exp.id, projectId: v === 'none' ? null : v }), v === 'none' ? 'Unlinked' : 'Linked to project')} noneLabel="Not linked to a project" />
          </div>
        )}
        <Menu>
          <MenuTrigger asChild><IconButton label="Experience actions" size="md"><MoreHorizontal className="size-4" /></IconButton></MenuTrigger>
          <MenuContent>
            <MenuItem icon={<RefreshCw />} onSelect={() => act('refresh', () => invoke('exp_refresh', { id: exp.id }), 'Experience info refreshed')}>Refresh name and places</MenuItem>
            <MenuItem icon={<Download />} onSelect={() => act('fetch', () => invoke('exp_fetch_current_icon', { id: exp.id }), 'Current icon downloaded from Roblox')}>Use the icon live on Roblox now</MenuItem>
            {exp.project_id && <MenuItem icon={<Link2 />} onSelect={() => navigate(`/projects/${exp.project_id}`)}>Open project</MenuItem>}
            <MenuItem icon={<ExternalLink />} onSelect={() => invoke('open_external', { url: `https://create.roblox.com/dashboard/creations/experiences/${exp.universe_id}/overview` })}>Open in Creator Hub</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} danger disabled={running} onSelect={async () => { if (await confirm({ title: `Remove ${exp.name} from this PC?`, body: 'Its schedule and icon files on this PC are removed. Your project and team history are kept.', danger: true, confirm: 'Remove' })) act('remove', async () => { await invoke('exp_remove', { id: exp.id }); navigate('/publish'); }); }}>Remove from this PC</MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {running ? <LiveUpdate exp={exp} busy={busy} act={act} /> : <PlanUpdate exp={exp} act={act} busy={busy} />}
      <History exp={exp} />
    </div>
  );
}

// ------------------------------------------------------------------ plan

function PlanUpdate({ exp, act, busy }: { exp: EngineExperience; act: (k: string, f: () => Promise<unknown>, ok?: string) => Promise<void>; busy: string | null }) {
  const state = useEngine((s) => s.state)!;
  const use24h = state.settings.use_24h;
  const [title, setTitle] = useState(exp.announce_title);
  const [body, setBody] = useState(exp.announce_body);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const now = useNow(1000);
  const at = exp.planned_at;
  const finished = exp.update && !ACTIVE.includes(exp.update.status);

  const setAt = (ms: number | null) => invoke('exp_set_plan', { id: exp.id, at: ms }).catch((e) => toast.error(String(e.message ?? e)));
  const saveAnnouncement = () => (title !== exp.announce_title || body !== exp.announce_body) && invoke('exp_set_plan', { id: exp.id, at: exp.planned_at, announceTitle: title, announceBody: body });

  const presets = useMemo(() => {
    const d = new Date();
    const tonight = new Date(d);
    tonight.setHours(18, 0, 0, 0);
    if (tonight.getTime() < Date.now() + 3600_000) tonight.setDate(tonight.getDate() + 1);
    const tomorrow = new Date(d);
    tomorrow.setDate(d.getDate() + 1);
    tomorrow.setHours(16, 0, 0, 0);
    const sat = new Date(d);
    sat.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
    sat.setHours(14, 0, 0, 0);
    return [
      { label: 'In 24 hours', at: Math.ceil((Date.now() + 86400_000) / 900_000) * 900_000 },
      { label: `${tonight.getDate() === d.getDate() ? 'Today' : 'Tomorrow'} 6 PM`, at: tonight.getTime() },
      { label: 'Tomorrow 4 PM', at: tomorrow.getTime() },
      { label: 'Saturday 2 PM', at: sat.getTime() },
    ];
  }, []);

  const firstStep = at && exp.timers.length ? at - Math.max(...exp.timers.map((t) => t.hours)) * 3600_000 : null;
  const problems: string[] = [];
  if (!state.hasCredential) problems.push('Connect your Roblox account (Settings → Integrations).');
  if (!exp.new_icon) problems.push('Choose the new icon.');
  if (!at) problems.push('Pick the update time.');
  else if (at <= now) problems.push('The update time is in the past.');
  if (!exp.places.some((p) => p.enabled)) problems.push('Turn on at least one place.');

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4">
      <div className="space-y-4">
        {finished && (
          <Notice tone={exp.update!.status === 'done' ? 'success' : 'neutral'} icon={exp.update!.status === 'done' ? <CheckCircle2 /> : <XCircle />} action={<Button size="xs" variant="ghost" onClick={() => invoke('exp_clear_finished', { id: exp.id })}>Dismiss</Button>}>
            {exp.update!.status === 'done' ? `The new icon went live on ${exp.update!.place_names.length} place(s) ${timeAgo(exp.update!.finished_at)}.` : `The last update was cancelled ${timeAgo(exp.update!.finished_at)}.`}
          </Notice>
        )}
        <Card title={<StepTitle n={1} done={!!exp.new_icon}>Icons</StepTitle>} description="Square images work best; anything else is cropped to the centre and resized to 512×512.">
          <div className="grid grid-cols-2 gap-4">
            <IconSlot label="Current icon" hint="Countdown overlays go on top of this" name={exp.current_icon} onPick={(d) => act('cur', () => invoke('exp_set_image', { id: exp.id, which: 'current', data: d }))} onClear={() => invoke('exp_set_image', { id: exp.id, which: 'current', data: null })} extra={<Button size="xs" variant="ghost" icon={<Download className="size-3" />} loading={busy === 'fetch'} onClick={() => act('fetch', () => invoke('exp_fetch_current_icon', { id: exp.id }), 'Downloaded the live icon')}>Use live icon</Button>} />
            <IconSlot label="New icon" hint="Goes live at the update time" name={exp.new_icon} onPick={(d) => act('new', () => invoke('exp_set_image', { id: exp.id, which: 'new', data: d }))} onClear={() => invoke('exp_set_image', { id: exp.id, which: 'new', data: null })} highlight />
          </div>
        </Card>

        <Card title={<StepTitle n={2} done={!!at && at > now}>When</StepTitle>} description="Your local time. Countdown icons start switching before this.">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input type="datetime-local" value={at ? toLocalInput(at) : ''} min={toLocalInput(Date.now() + 60_000)} onChange={(e) => setAt(e.target.value ? new Date(e.target.value).getTime() : null)} className="w-[230px]" aria-label="Update time" />
              {presets.map((p) => (
                <Button key={p.label} size="sm" variant={at === p.at ? 'secondary' : 'ghost'} onClick={() => setAt(p.at)}>{p.label}</Button>
              ))}
            </div>
            {at && (
              <p className="text-[12.5px] text-fg-muted">
                <CalendarClock className="mr-1.5 inline size-3.5 text-fg-subtle" />
                {longDate(at, use24h)} · in <span className="tabular text-fg">{countdown(at - now)}</span>
                {firstStep && firstStep < now && <span className="text-warning"> · Steps already in the past will be skipped.</span>}
              </p>
            )}
          </div>
        </Card>

        <Card title={<StepTitle n={3} done={exp.timers.length > 0}>Countdown steps</StepTitle>} description="Each step swaps in a countdown version of your current icon. Upload your own overlay art per step, or use the built-in ones.">
          <TimersEditor exp={exp} />
        </Card>

        <Card title="Places" description="The icon is switched on every place that is turned on." padded={false}>
          <div className="divide-y divide-line">
            {exp.places.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-hover">
                <span className="flex-1 truncate text-[13px]">{p.name}</span>
                <span className="font-mono text-[11.5px] text-fg-subtle">{p.id}</span>
                <Switch checked={p.enabled} label={`Switch icon on ${p.name}`} onChange={(v) => invoke('exp_set_place', { id: exp.id, placeId: p.id, enabled: v })} />
              </label>
            ))}
          </div>
        </Card>

        <Card title={<span className="flex items-center gap-2"><Megaphone className="size-3.5 text-fg-muted" />Update announcement</span>} description="Shown in the preview and shared with your team. Copy it to Discord, your group wall or social posts.">
          <div className="space-y-3">
            <Field label="Headline"><Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} onBlur={saveAnnouncement} placeholder="Winter Update is coming!" /></Field>
            <Field label="Details"><Textarea value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} onBlur={saveAnnouncement} placeholder={'New map, 20 new items and a snowball fight event.\nJoin at the update time for a free hat!'} rows={4} /></Field>
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="sticky top-4 space-y-4">
          <Preview exp={exp} title={title} body={body} />
          <Card>
            {problems.length > 0 ? (
              <ul className="mb-3 space-y-1.5">
                {problems.map((p) => <li key={p} className="flex items-start gap-2 text-[12.5px] text-fg-muted"><Circle className="mt-0.5 size-3 shrink-0 text-fg-subtle" />{p}</li>)}
              </ul>
            ) : (
              <p className="mb-3 flex items-center gap-2 text-[12.5px] text-success"><Check className="size-3.5" />Ready to schedule</p>
            )}
            <Button variant="primary" className="w-full" icon={<Rocket className="size-3.5" />} disabled={problems.length > 0} loading={busy === 'start'} onClick={() => setConfirmOpen(true)}>Schedule update</Button>
            <p className="mt-2 text-center text-[11.5px] text-fg-subtle">Keep this PC on until the update. Corel runs in the tray.</p>
          </Card>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen} title="Schedule this update?" width={460}
        footer={<><Button variant="ghost" onClick={() => setConfirmOpen(false)}>Back</Button><Button variant="primary" icon={<Rocket className="size-3.5" />} loading={busy === 'start'} onClick={async () => { await saveAnnouncement(); await act('start', () => invoke('exp_start_update', { id: exp.id }), 'Update scheduled. Countdown icons are uploading now.'); setConfirmOpen(false); }}>Schedule</Button></>}>
        <div className="space-y-2 text-[13px] text-fg-muted">
          <p><span className="text-fg">{exp.name}</span> gets its new icon on <span className="text-fg">{at && longDate(at, use24h)}</span>.</p>
          <p>Countdown steps: {exp.timers.map((t) => t.label).join(', ') || 'none'}.</p>
          <p>Places: {exp.places.filter((p) => p.enabled).map((p) => p.name).join(', ')}.</p>
          <p>All images are uploaded to Roblox now so moderation can approve them in time. If a step isn’t approved when it’s due, Corel waits and tells you.</p>
        </div>
      </Dialog>
    </div>
  );
}

function StepTitle({ n, done, children }: { n: number; done: boolean; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className={cn('grid size-[18px] place-items-center rounded-full text-[10.5px] font-semibold', done ? 'bg-accent text-accent-fg' : 'bg-active text-fg-muted')}>{done ? <Check className="size-3" /> : n}</span>
      {children}
    </span>
  );
}

function IconSlot({ label, hint, name, onPick, onClear, extra, highlight }: { label: string; hint: string; name: string | null; onPick: (dataUrl: string) => void; onClear: () => void; extra?: React.ReactNode; highlight?: boolean }) {
  const [over, setOver] = useState(false);
  const pick = async () => {
    const f = await pickFile('image/png,image/jpeg,image/webp');
    if (f) onPick(await fileToDataUrl(f));
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-medium">{label}</p>
        {extra}
      </div>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${name ? 'Replace' : 'Choose'} ${label.toLowerCase()}`}
        onClick={pick}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && pick()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onPick(await fileToDataUrl(f)); }}
        className={cn('group relative grid aspect-square w-full cursor-pointer place-items-center overflow-hidden rounded-lg border transition-colors', over ? 'border-accent bg-accent-soft' : name ? 'border-line' : 'border-dashed border-line-strong hover:border-fg-subtle', highlight && name && 'ring-2 ring-accent/50')}
      >
        {name ? (
          <>
            <img src={engineImage(name)} alt="" className="size-full object-cover" />
            <span className="absolute inset-0 grid place-items-center bg-black/55 text-[12.5px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"><span className="flex items-center gap-1.5"><Upload className="size-3.5" />Replace</span></span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-1.5 text-[12.5px] text-fg-muted"><Upload className="size-4" />Drop or click to choose<span className="text-[11.5px] text-fg-subtle">PNG, JPG or WebP</span></span>
        )}
      </div>
      <div className="flex items-center justify-between text-[11.5px] text-fg-subtle">
        <span>{hint}</span>
        {name && <button className="hover:text-fg" onClick={onClear}>Remove</button>}
      </div>
    </div>
  );
}

function TimersEditor({ exp }: { exp: EngineExperience }) {
  const [draft, setDraft] = useState(exp.timers.map((t) => ({ ...t })));
  useEffect(() => setDraft(exp.timers.map((t) => ({ ...t }))), [JSON.stringify(exp.timers)]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (next: { id?: string; hours: number; label: string }[]) => {
    try {
      await invoke('exp_set_timers', { id: exp.id, timers: next.map((t) => ({ id: t.id ?? null, hours: t.hours, label: t.label })) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const defaultLabel = (h: number) => (h >= 24 && h % 24 === 0 ? `${h / 24} Day${h === 24 ? '' : 's'}` : h < 1 ? `${Math.round(h * 60)} Minutes` : `${h} Hour${h === 1 ? '' : 's'}`);
  return (
    <div className="space-y-2">
      {draft.length === 0 && <p className="text-[12.5px] text-fg-subtle">No countdown steps: the icon switches straight to the new one at the update time.</p>}
      {draft.map((t, i) => (
        <div key={t.id} className="flex items-center gap-2">
          <TimerThumb exp={exp} timer={exp.timers.find((x) => x.id === t.id)} />
          <div className="flex w-[120px] items-center gap-1.5">
            <Input type="number" min={0.25} max={336} step={0.25} value={t.hours} aria-label="Hours before the update" className="h-7 w-[70px]"
              onChange={(e) => setDraft(draft.map((d, j) => (j === i ? { ...d, hours: Number(e.target.value) } : d)))}
              onBlur={() => save(draft)} />
            <span className="text-[12px] text-fg-subtle">h before</span>
          </div>
          <Input value={t.label} maxLength={24} aria-label="Label on the icon" className="h-7 flex-1"
            onChange={(e) => setDraft(draft.map((d, j) => (j === i ? { ...d, label: e.target.value } : d)))}
            onBlur={() => save(draft)} />
          <Tooltip content={t.overlay ? 'Replace custom overlay' : 'Upload custom overlay art (transparent PNG)'}>
            <IconButton label="Custom overlay" onClick={async () => { const f = await pickFile('image/png,image/webp'); if (f) { try { await invoke('exp_set_overlay', { id: exp.id, timerId: t.id, data: await fileToDataUrl(f) }); } catch (e) { toast.error((e as Error).message); } } }}>
              <ImageIcon className={cn('size-3.5', t.overlay && 'text-accent-text')} />
            </IconButton>
          </Tooltip>
          {t.overlay && <IconButton label="Use built-in overlay" onClick={() => invoke('exp_set_overlay', { id: exp.id, timerId: t.id, data: null })}><RotateCcw className="size-3.5" /></IconButton>}
          <IconButton label="Remove step" onClick={() => save(draft.filter((_, j) => j !== i))}><X className="size-3.5" /></IconButton>
        </div>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => { const h = draft.length ? Math.max(0.5, Math.min(...draft.map((d) => d.hours)) / 2) : 1; save([...draft, { hours: h, label: defaultLabel(h) }]); }}>Add step</Button>
        <Button size="sm" variant="ghost" onClick={() => save([12, 6, 3, 1].map((h) => ({ hours: h, label: defaultLabel(h) })))}>Reset to 12h · 6h · 3h · 1h</Button>
        <Button size="sm" variant="ghost" onClick={() => save([48, 24, 12, 1].map((h) => ({ hours: h, label: defaultLabel(h) })))}>Use 2 days · 1 day · 12h · 1h</Button>
      </div>
    </div>
  );
}

const previewCache = new Map<string, string>();

function usePreview(exp: EngineExperience, timer: EngineTimer | undefined | 'new') {
  const key = timer === 'new' ? `new|${exp.new_icon}` : timer ? `${exp.current_icon}|${timer.overlay}|${timer.label}` : '';
  const [url, setUrl] = useState<string | null>(previewCache.get(key) ?? null);
  useEffect(() => {
    if (!key || (timer === 'new' && !exp.new_icon)) {
      setUrl(null);
      return;
    }
    if (previewCache.has(key)) {
      setUrl(previewCache.get(key)!);
      return;
    }
    let cancelled = false;
    invoke<string>('exp_preview', { id: exp.id, timerId: timer === 'new' ? 'new' : timer!.id })
      .then((u) => {
        previewCache.set(key, u);
        if (!cancelled) setUrl(u);
      })
      .catch(() => !cancelled && setUrl(null));
    return () => {
      cancelled = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

function TimerThumb({ exp, timer }: { exp: EngineExperience; timer?: EngineTimer }) {
  const url = usePreview(exp, timer);
  return url ? <img src={url} alt={timer?.label} className="size-8 shrink-0 rounded-md ring-1 ring-line" /> : <span className="size-8 shrink-0 rounded-md bg-active" />;
}

function Preview({ exp, title, body }: { exp: EngineExperience; title: string; body: string }) {
  const steps: (EngineTimer | 'new')[] = [...[...exp.timers].sort((a, b) => b.hours - a.hours), 'new'];
  const [sel, setSel] = useState(0);
  const now = useNow(1000);
  const current = steps[Math.min(sel, steps.length - 1)];
  const url = usePreview(exp, current);
  const at = exp.planned_at;
  return (
    <Card title="Preview" description="What players see on the experience page" padded={false}>
      <div className="p-4">
        <div className="overflow-hidden rounded-lg border border-line bg-sunken">
          <div className="relative aspect-square w-full">
            {url ? <img src={url} alt="Icon preview" className="size-full object-cover animate-fade-in" key={url} /> : <div className="grid size-full place-items-center text-[12.5px] text-fg-subtle">{current === 'new' ? 'Choose a new icon' : 'Choose the current icon'}</div>}
          </div>
          <div className="space-y-0.5 border-t border-line px-3 py-2">
            <p className="truncate text-[13px] font-semibold">{exp.name}</p>
            <p className="text-[11.5px] text-fg-subtle">{current === 'new' ? 'New icon · at the update time' : `${current.label} · ${at ? shortDate(at - current.hours * 3600_000) : `${current.hours}h before`}`}</p>
          </div>
        </div>
        <div className="mt-3 flex gap-1.5" role="tablist" aria-label="Countdown steps">
          {steps.map((s, i) => (
            <button key={s === 'new' ? 'new' : s.id} role="tab" aria-selected={sel === i} onClick={() => setSel(i)} className={cn('flex-1 truncate rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors', sel === i ? 'bg-accent-soft text-accent-text' : 'text-fg-muted hover:bg-hover')}>
              {s === 'new' ? 'New' : s.label.replace(/ Hours?| Minutes?| Days?/, (m) => m.trim()[0].toLowerCase())}
            </button>
          ))}
        </div>
      </div>
      {(title || body) && (
        <div className="border-t border-line p-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">Announcement</p>
          <div className="rounded-md border-l-[3px] border-accent bg-raised p-3">
            <p className="text-[13px] font-semibold">{title || exp.name}</p>
            {body && <p className="selectable mt-1 whitespace-pre-wrap text-[12.5px] text-fg-muted">{body}</p>}
            {at && <p className="mt-2 text-[12px] text-fg"><Clock className="mr-1 inline size-3 text-accent-text" />{at > now ? <>Live in <span className="tabular font-semibold">{countdown(at - now)}</span></> : 'Live now'} · {shortDate(at)}</p>}
          </div>
          <Button size="xs" variant="ghost" className="mt-2" onClick={() => { navigator.clipboard.writeText(`**${title || exp.name}**\n${body}${at ? `\n\nGoes live <t:${Math.floor(at / 1000)}:R> (<t:${Math.floor(at / 1000)}:F>)` : ''}`); toast.success('Copied as a Discord message'); }}>Copy for Discord</Button>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ live

function stepState(s: EngineStep): { label: string; tone: 'success' | 'accent' | 'warning' | 'danger' | 'neutral'; icon: React.ReactNode } {
  if (s.apply === 'done') return { label: 'Shown', tone: 'neutral', icon: <Check className="size-3" /> };
  if (s.apply === 'live') return { label: 'Live now', tone: 'success', icon: <CheckCircle2 className="size-3" /> };
  if (s.apply === 'skipped') return { label: 'Skipped', tone: 'neutral', icon: <ArrowRight className="size-3" /> };
  if (s.apply === 'error' || s.moderation === 'Rejected') return { label: s.moderation === 'Rejected' ? 'Rejected by Roblox' : 'Failed', tone: 'danger', icon: <XCircle className="size-3" /> };
  if (s.apply === 'retrying') return { label: 'Retrying', tone: 'warning', icon: <RefreshCw className="size-3" /> };
  if (s.apply === 'waiting') return { label: 'Due · awaiting approval', tone: 'warning', icon: <Clock className="size-3" /> };
  if (s.upload === 'uploading') return { label: 'Uploading', tone: 'accent', icon: <Loader2 className="size-3 animate-spin" /> };
  if (s.upload === 'error') return { label: 'Upload failed, retrying', tone: 'warning', icon: <RefreshCw className="size-3" /> };
  if (s.upload === 'pending') return { label: 'Waiting to upload', tone: 'neutral', icon: <Circle className="size-3" /> };
  if (s.moderation === 'Approved') return { label: 'Approved · ready', tone: 'success', icon: <ShieldCheck className="size-3" /> };
  return { label: 'In moderation', tone: 'accent', icon: <Loader2 className="size-3 animate-spin" /> };
}

function LiveUpdate({ exp, busy, act }: { exp: EngineExperience; busy: string | null; act: (k: string, f: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const u = exp.update!;
  const now = useNow(1000);
  const use24h = useEngine((s) => s.state?.settings.use_24h ?? false);
  const steps = u.steps.filter((s) => !s.hidden);
  const uploaded = steps.filter((s) => s.upload === 'done' || s.upload === 'skipped').length;
  const approved = steps.filter((s) => s.moderation === 'Approved' || s.moderation === 'skipped').length;
  const next = steps.find((s) => ['upcoming', 'waiting', 'retrying'].includes(s.apply));
  const total = u.at - u.started_at;
  const pct = total > 0 ? Math.min(100, ((now - u.started_at) / total) * 100) : 100;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-accent/30 bg-panel">
        <div className="flex items-center gap-6 p-5">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[12px] font-medium text-accent-text"><span className="live-dot size-1.5 rounded-full bg-accent" />{STATUS_LABEL[u.status]}</p>
            <p className="tabular mt-1 text-[34px] font-semibold leading-none tracking-[-0.03em]">{u.status === 'restoring' ? 'Restoring' : countdown(u.at - now)}</p>
            <p className="mt-2 text-[12.5px] text-fg-muted">New icon goes live {longDate(u.at, use24h)}</p>
          </div>
          <div className="w-[220px] space-y-2 text-[12px]">
            <div className="flex justify-between text-fg-muted"><span>Uploaded</span><span className="tabular text-fg">{uploaded}/{steps.length}</span></div>
            <Progress value={(uploaded / steps.length) * 100} />
            <div className="flex justify-between text-fg-muted"><span>Approved by Roblox</span><span className="tabular text-fg">{approved}/{steps.length}</span></div>
            <Progress value={(approved / steps.length) * 100} tone="success" />
          </div>
        </div>
        <Progress value={pct} className="h-1 rounded-none" />
        {next && (
          <div className="flex items-center gap-2 border-t border-line bg-sunken/50 px-5 py-2.5 text-[12.5px]">
            <Clock className="size-3.5 text-fg-subtle" />
            <span className="text-fg-muted">Next:</span> {next.label} {next.at && <>in <span className="tabular font-medium">{countdown(next.at - now)}</span></>}
            <Button size="sm" variant="danger" className="ml-auto" icon={<X className="size-3.5" />} loading={busy === 'cancel'}
              onClick={async () => { if (await confirm({ title: 'Cancel this update?', body: 'If a countdown icon is already showing, Corel puts the original icon back.', danger: true, confirm: 'Cancel update' })) act('cancel', () => invoke('exp_cancel_update', { id: exp.id }), 'Update cancelled'); }}>
              Cancel update
            </Button>
          </div>
        )}
      </div>

      <Card title="Steps" padded={false}>
        <ol className="divide-y divide-line">
          {steps.map((s) => {
            const st = stepState(s);
            return (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                <img src={engineImage(s.image)} alt="" className={cn('size-11 rounded-md ring-1 ring-line', (s.apply === 'done' || s.apply === 'skipped') && 'opacity-50')} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{s.label}</p>
                  <p className="text-[11.5px] text-fg-subtle">{s.at ? shortDate(s.at, use24h) : 'Standby'}{s.applied_at && ` · applied ${timeAgo(s.applied_at)}`}{s.asset_id && <> · <span className="font-mono">asset {s.asset_id}</span></>}</p>
                  {s.error && <p className="mt-0.5 text-[11.5px] text-danger">{s.error}</p>}
                </div>
                <Badge tone={st.tone}>{st.icon}{st.label}</Badge>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card title="Log" padded={false}>
        <ul className="max-h-[220px] overflow-y-auto px-4 py-2 font-mono text-[11.5px]">
          {u.log.length === 0 ? <li className="py-1 text-fg-subtle">Starting…</li> : u.log.map((l, i) => (
            <li key={i} className="flex gap-3 py-0.5"><span className="shrink-0 text-fg-subtle">{new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: !use24h })}</span><span className="selectable text-fg-muted">{l.msg}</span></li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ history

function History({ exp }: { exp: EngineExperience }) {
  const team = useWorkspace((s) => s.publish.filter((u) => exp.project_id && u.project_id === exp.project_id));
  const signedIn = useSession((s) => s.status === 'signed-in');
  const use24h = useEngine((s) => s.state?.settings.use_24h ?? false);
  if (signedIn && exp.project_id) {
    return <Card title="Update history" description="Shared with your team" className="mt-4" padded={false}><PublishHistoryList updates={team} /></Card>;
  }
  return (
    <Card title="Update history" className="mt-4" padded={false}>
      {exp.history.length === 0 ? <EmptyState compact icon={<CalendarClock />} title="No updates yet" /> : (
        <ul className="divide-y divide-line">
          {exp.history.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-4 py-2 text-[12.5px]">
              {h.status === 'done' ? <CheckCircle2 className="size-3.5 text-success" /> : <XCircle className="size-3.5 text-fg-subtle" />}
              <span className="flex-1">{h.status === 'done' ? 'Published' : 'Cancelled'} · planned for {shortDate(h.at, use24h)}</span>
              <span className="text-fg-subtle">{timeAgo(h.finished_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function PublishHistoryList({ updates }: { updates: PublishUpdate[] }) {
  const now = useNow(1000);
  if (!updates.length) return <EmptyState compact icon={<CalendarClock />} title="No updates yet" body="Scheduled and past icon updates for this project appear here for the whole team." />;
  return (
    <ul className="divide-y divide-line">
      {updates.map((u) => {
        const live = u.steps.filter((s) => s.apply === 'live' || s.apply === 'done').pop();
        return (
          <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
            {u.status === 'done' ? <CheckCircle2 className="size-4 text-success" /> : u.status === 'cancelled' ? <XCircle className="size-4 text-fg-subtle" /> : <Rocket className="size-4 text-accent-text" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px]">{u.announcement_title || (u.status === 'done' ? 'New icon published' : u.status === 'cancelled' ? 'Update cancelled' : 'Scheduled update')}</p>
              <p className="truncate text-[11.5px] text-fg-subtle">{longDate(u.update_at)} · {u.place_names.length} place(s) · on {u.machine || 'a team PC'}{live && ACTIVE.includes(u.status) && ` · showing ${live.label}`}</p>
            </div>
            <UserChip userId={u.scheduled_by} />
            <Badge tone={u.status === 'done' ? 'success' : u.status === 'cancelled' ? 'neutral' : 'accent'}>{ACTIVE.includes(u.status) ? countdown(new Date(u.update_at).getTime() - now) : STATUS_LABEL[u.status]}</Badge>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------ add / relay

function AddExperienceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const signedIn = useSession((s) => s.status === 'signed-in');
  const offline = useUI((s) => s.offline);
  const projects = useWorkspace((s) => s.projects.filter((p) => p.universe_id && !p.archived));
  const local = useEngine((s) => s.state?.experiences ?? []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setInput('');
      setError(null);
    }
  }, [open]);
  const add = async (value: string, projectId: string | null, universeId?: string) => {
    setBusy(true);
    setError(null);
    try {
      const id = await invoke<string>('exp_add', { input: value, projectId, universeId: universeId ?? null });
      onClose();
      navigate(`/publish/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const unlinked = projects.filter((p) => !local.some((e) => e.universe_id === p.universe_id));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Add an experience" width={500}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!input.trim()} onClick={() => add(input, null)}>Add</Button></>}>
      <div className="space-y-4">
        {signedIn && !offline && unlinked.length > 0 && (
          <div>
            <p className="mb-2 text-[12px] font-medium text-fg-muted">From your projects</p>
            <div className="space-y-1">
              {unlinked.map((p) => (
                <button key={p.id} disabled={busy} onClick={() => add(p.universe_id!, p.id, p.universe_id!)} className="flex w-full items-center gap-3 rounded-md border border-line px-3 py-2 text-left hover:border-line-strong hover:bg-hover">
                  <ProjectThumb project={p} size={28} />
                  <span className="flex-1 truncate text-[13px]">{p.name}</span>
                  <span className="font-mono text-[11.5px] text-fg-subtle">{p.universe_id}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Roblox game link, place ID or universe ID" error={error}>
          <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && input.trim() && add(input, null)} placeholder="https://www.roblox.com/games/1234567890/My-Game" autoFocus />
        </Field>
      </div>
    </Dialog>
  );
}

function PhoneRelayButton() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ url: string; qr: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setOpen(true);
    setError(null);
    try {
      setData(await invoke('relay_start'));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <Button variant="ghost" size="sm" className="w-full justify-start" icon={<Smartphone className="size-3.5" />} onClick={start}>Follow on your phone</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Follow updates on your phone" description="Scan with your phone on the same Wi-Fi to see live countdowns. This PC still does the icon switching." width={400}
        footer={<><Button variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={async () => setData(await invoke('relay_rotate'))}>New link</Button><Button onClick={() => setOpen(false)}>Done</Button></>}>
        {error ? <Notice tone="warning">{error}</Notice> : data ? (
          <div className="flex flex-col items-center gap-3">
            <img src={data.qr} alt="QR code for the phone relay" className="size-[220px] rounded-lg bg-white p-2" />
            <p className="selectable break-all text-center font-mono text-[11px] text-fg-subtle">{data.url}</p>
            <p className="text-center text-[12px] text-fg-muted"><QrCode className="mr-1 inline size-3" />If Windows asks about network access, allow private networks. “New link” revokes the old one.</p>
          </div>
        ) : <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin" /></div>}
      </Dialog>
    </>
  );
}

