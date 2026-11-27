import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowDownUp, Bug as BugIcon, Copy, Download, FileText, Image as ImageIcon, MoreHorizontal, Paperclip, Search, Trash2, X } from 'lucide-react';
import { Badge, Button, EmptyState, IconButton, Input, Menu, MenuContent, MenuItem, MenuTrigger, Select, Sheet, Tabs, Textarea, confirm } from './ui';
import { BugStatusIcon, MemberSelect, ProjectSelect, ProjectThumb, SeverityBadge, UserAvatar, UserChip, bugStatusOptions, isOpenBug, severityOptions, PresenceStack } from './common';
import { Comments } from './comments';
import { ActivityRow } from './activity';
import { FilePicker } from './dialogs/CreateDialogs';
import { deleteBug, updateBug, uploadAttachment } from '@/lib/actions';
import { getSupabase, sb } from '@/lib/supabase';
import { bytes, cn, shortDate, timeAgo } from '@/lib/format';
import { projectPerm } from '@/lib/perms';
import { useMe, useWorkspace } from '@/store/workspace';
import { useSession } from '@/store/session';
import { usePresence } from '@/store/presence';
import type { Attachment, Bug, BugStatus, Severity } from '@/lib/types';

type SortKey = 'updated' | 'created' | 'severity' | 'number';
const sevRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function BugTable({ projectId, initialFilter }: { projectId?: string; initialFilter?: { assignee?: string; status?: string } }) {
  const all = useWorkspace((s) => s.bugs);
  const projects = useWorkspace((s) => s.projects);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [project, setProject] = useState(projectId ?? 'all');
  const [status, setStatus] = useState(initialFilter?.status ?? 'open');
  const [severity, setSeverity] = useState('all');
  const [assignee, setAssignee] = useState<string | null>(initialFilter?.assignee ?? 'all');
  const [sort, setSort] = useState<SortKey>('updated');

  useEffect(() => {
    if (initialFilter?.assignee) setAssignee(initialFilter.assignee);
    if (initialFilter?.status) setStatus(initialFilter.status);
  }, [initialFilter?.assignee, initialFilter?.status]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all
      .filter((b) => (project === 'all' ? true : b.project_id === project))
      .filter((b) => (status === 'all' ? true : status === 'open' ? isOpenBug(b.status) : b.status === status))
      .filter((b) => (severity === 'all' ? true : b.severity === severity))
      .filter((b) => (assignee === 'all' ? true : assignee === null ? !b.assignee_id : b.assignee_id === assignee))
      .filter((b) => !term || b.title.toLowerCase().includes(term) || `bug-${b.number}`.includes(term) || b.description.toLowerCase().includes(term))
      .sort((a, b) =>
        sort === 'severity' ? sevRank[a.severity] - sevRank[b.severity] || b.updated_at.localeCompare(a.updated_at) : sort === 'number' ? b.number - a.number : sort === 'created' ? b.created_at.localeCompare(a.created_at) : b.updated_at.localeCompare(a.updated_at),
      );
  }, [all, q, project, status, severity, assignee, sort]);

  const filtersActive = q || (!projectId && project !== 'all') || status !== 'open' || severity !== 'all' || assignee !== 'all';

  return (
    <div className="flex flex-col rounded-lg border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
        <div className="w-[240px]"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bugs…" icon={<Search />} className="h-7" aria-label="Search bugs" /></div>
        {!projectId && <div className="w-[170px]"><ProjectSelect value={project} onChange={setProject} allowAll="All projects" size="sm" includeArchived /></div>}
        <div className="w-[140px]"><Select label="Status" size="sm" value={status} onChange={setStatus} options={[{ value: 'open', label: 'Unresolved' }, { value: 'all', label: 'Any status' }, ...bugStatusOptions]} /></div>
        <div className="w-[130px]"><Select label="Severity" size="sm" value={severity} onChange={setSeverity} options={[{ value: 'all', label: 'Any severity' }, ...severityOptions]} /></div>
        <div className="w-[160px]"><MemberSelect value={assignee} onChange={setAssignee} size="sm" allowAll="Anyone" label="Assignee filter" /></div>
        {filtersActive && <Button size="sm" variant="ghost" icon={<X className="size-3" />} onClick={() => { setQ(''); if (!projectId) setProject('all'); setStatus('open'); setSeverity('all'); setAssignee('all'); }}>Clear</Button>}
        <div className="ml-auto flex items-center gap-1.5">
          <ArrowDownUp className="size-3.5 text-fg-subtle" />
          <div className="w-[140px]"><Select label="Sort" size="sm" value={sort} onChange={setSort} options={[{ value: 'updated', label: 'Last updated' }, { value: 'created', label: 'Newest' }, { value: 'severity', label: 'Severity' }, { value: 'number', label: 'Number' }]} /></div>
        </div>
      </div>
      {list.length === 0 ? (
        <EmptyState compact icon={<BugIcon />} title={all.length ? 'No bugs match these filters' : 'No bugs reported yet'} body={all.length ? 'Try clearing the filters.' : 'When someone reports a bug it appears here for the whole team instantly.'} />
      ) : (
        <div role="table" aria-label="Bugs" className="divide-y divide-line">
          {list.map((b) => {
            const p = projects.find((x) => x.id === b.project_id);
            return (
              <button key={b.id} role="row" onClick={() => navigate(`/bugs/${b.id}`)} className="grid w-full grid-cols-[18px_64px_minmax(0,1fr)_auto_auto_90px_24px] items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-hover">
                <BugStatusIcon status={b.status} />
                <span className="font-mono text-[11.5px] text-fg-subtle">BUG-{b.number}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn('truncate text-[13px]', !isOpenBug(b.status) && 'text-fg-muted line-through decoration-fg-subtle/50')}>{b.title}</span>
                  <RowPresence bugId={b.id} />
                </span>
                {!projectId && p ? <span className="flex max-w-[150px] items-center gap-1.5 truncate text-[12px] text-fg-muted"><ProjectThumb project={p} size={14} /><span className="truncate">{p.name}</span></span> : <span />}
                <SeverityBadge severity={b.severity} />
                <span className="text-right text-[11.5px] text-fg-subtle">{timeAgo(b.updated_at)}</span>
                <UserAvatar userId={b.assignee_id} size={20} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RowPresence({ bugId }: { bugId: string }) {
  const n = usePresence((s) => Object.values(s.online).filter((p) => p.route === `/bugs/${bugId}`).length);
  return n ? <PresenceStack filter={(p) => p.route === `/bugs/${bugId}`} size={16} max={3} /> : null;
}

// ------------------------------------------------------------------ detail

export function BugDetailSheet({ bugId, onClose }: { bugId: string | undefined; onClose: () => void }) {
  return (
    <Sheet open={!!bugId} onOpenChange={(o) => !o && onClose()} width={720} label="Bug details">
      {bugId && <BugDetail bugId={bugId} onClose={onClose} />}
    </Sheet>
  );
}

function BugDetail({ bugId, onClose }: { bugId: string; onClose: () => void }) {
  const bug = useWorkspace((s) => s.bugs.find((b) => b.id === bugId));
  const project = useWorkspace((s) => s.projects.find((p) => p.id === bug?.project_id));
  const activity = useWorkspace((s) => s.activity.filter((a) => a.entity_type === 'bug' && a.entity_id === bugId));
  const me = useMe();
  const uid = useSession((s) => s.user?.id);
  const prole = useWorkspace((s) => s.projectMembers.find((m) => m.project_id === bug?.project_id && m.user_id === uid)?.role);
  const [tab, setTab] = useState<'discussion' | 'history'>('discussion');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [steps, setSteps] = useState('');
  const [env, setEnv] = useState('');
  const [editingText, setEditingText] = useState(false);
  const [history, setHistory] = useState<typeof activity | null>(null);

  useEffect(() => {
    if (bug && !editingText) {
      setTitle(bug.title);
      setDesc(bug.description);
      setSteps(bug.steps);
      setEnv(bug.environment);
    }
  }, [bug?.title, bug?.description, bug?.steps, bug?.environment, editingText]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab !== 'history') return;
    getSupabase()?.from('activity').select('*').eq('entity_type', 'bug').eq('entity_id', bugId).order('created_at', { ascending: false }).limit(200).then(({ data }) => setHistory((data as typeof activity) || []));
  }, [tab, bugId, activity.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!bug) {
    return <EmptyState icon={<BugIcon />} title="Bug not found" body="It may have been deleted, or you no longer have access." action={<Button onClick={onClose}>Close</Button>} />;
  }
  const canEdit = projectPerm(me, prole, 'edit_content');
  const canComment = projectPerm(me, prole, 'comment');
  const set = async (patch: Partial<Bug>) => {
    try {
      await updateBug(bug.id, patch);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const saveText = async () => {
    if (!title.trim()) return toast.error('A bug needs a title.');
    await set({ title: title.trim(), description: desc, steps, environment: env });
    setEditingText(false);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <BugStatusIcon status={bug.status} />
        <span className="font-mono text-[12px] text-fg-subtle">BUG-{bug.number}</span>
        {project && <span className="flex items-center gap-1.5 truncate text-[12px] text-fg-muted"><ProjectThumb project={project} size={14} />{project.name}</span>}
        <div className="ml-auto flex items-center gap-1">
          <PresenceStack filter={(p) => p.route === `/bugs/${bug.id}`} size={20} />
          <IconButton label="Copy reference" onClick={() => { navigator.clipboard.writeText(`BUG-${bug.number}: ${bug.title}`); toast.success('Copied'); }}><Copy className="size-3.5" /></IconButton>
          <Menu>
            <MenuTrigger asChild><IconButton label="More actions"><MoreHorizontal className="size-3.5" /></IconButton></MenuTrigger>
            <MenuContent>
              <MenuItem icon={<Trash2 />} danger disabled={!(me && (me.role === 'owner' || me.role === 'admin' || bug.reporter_id === uid))} onSelect={async () => { if (await confirm({ title: `Delete BUG-${bug.number}?`, body: 'Its comments and attachments are deleted too. This cannot be undone.', danger: true, confirm: 'Delete bug' })) { try { await deleteBug(bug.id); onClose(); toast.success('Bug deleted'); } catch (e) { toast.error((e as Error).message); } } }}>Delete bug</MenuItem>
            </MenuContent>
          </Menu>
          <IconButton label="Close" onClick={onClose}><X className="size-3.5" /></IconButton>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0 overflow-y-auto px-5 py-4">
          {editingText ? (
            <div className="space-y-3">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 text-[15px] font-semibold" aria-label="Title" />
              <Labeled label="Description"><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={5} /></Labeled>
              <Labeled label="Steps to reproduce"><Textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={4} /></Labeled>
              <Labeled label="Environment"><Textarea value={env} onChange={(e) => setEnv(e.target.value)} rows={2} /></Labeled>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditingText(false)}>Cancel</Button>
                <Button variant="primary" onClick={saveText}>Save changes</Button>
              </div>
            </div>
          ) : (
            <div className={cn('group -mx-2 rounded-lg px-2 py-1', canEdit && 'cursor-text hover:bg-hover')} onClick={() => canEdit && setEditingText(true)} role={canEdit ? 'button' : undefined} aria-label={canEdit ? 'Edit bug text' : undefined} tabIndex={canEdit ? 0 : undefined} onKeyDown={(e) => e.key === 'Enter' && canEdit && setEditingText(true)}>
              <h2 className="selectable text-[17px] font-semibold tracking-[-0.01em]">{bug.title}</h2>
              <TextBlock label="Description" text={bug.description} />
              <TextBlock label="Steps to reproduce" text={bug.steps} />
              <TextBlock label="Environment" text={bug.environment} />
              {canEdit && !bug.description && !bug.steps && <p className="mt-2 text-[12.5px] text-fg-subtle">Click to add a description and steps to reproduce.</p>}
            </div>
          )}
          <Attachments bug={bug} canEdit={canEdit} />
          <div className="mt-6">
            <Tabs value={tab} onChange={setTab} tabs={[{ value: 'discussion', label: 'Discussion' }, { value: 'history', label: 'History', count: activity.length || undefined }]} />
            <div className="pt-4">
              {tab === 'discussion' ? (
                <Comments projectId={bug.project_id} entityType="bug" entityId={bug.id} canComment={canComment} />
              ) : (
                <div>
                  {(history ?? activity).map((a) => <ActivityRow key={a.id} a={a} showProject={false} />)}
                  <p className="px-2 pt-2 text-[11.5px] text-fg-subtle">Reported {shortDate(bug.created_at)}{bug.fixed_at && ` · fixed ${shortDate(bug.fixed_at)}`}</p>
                </div>
              )}
            </div>
          </div>
        </div>
        <aside className="space-y-4 overflow-y-auto border-l border-line bg-sunken/40 p-4">
          <Prop label="Status"><Select label="Status" size="sm" value={bug.status} onChange={(v: BugStatus) => set({ status: v })} options={bugStatusOptions} disabled={!canEdit} /></Prop>
          <Prop label="Severity"><Select label="Severity" size="sm" value={bug.severity} onChange={(v: Severity) => set({ severity: v })} options={severityOptions} disabled={!canEdit} /></Prop>
          <Prop label="Assignee">{canEdit ? <MemberSelect value={bug.assignee_id} onChange={(v) => set({ assignee_id: v })} size="sm" /> : <UserChip userId={bug.assignee_id} />}</Prop>
          <Prop label="Project">{canEdit ? <ProjectSelect value={bug.project_id} onChange={(v) => set({ project_id: v })} size="sm" /> : <span className="text-[12.5px]">{project?.name}</span>}</Prop>
          <Prop label="Reporter"><UserChip userId={bug.reporter_id} /></Prop>
          <Prop label="Created"><span className="text-[12.5px] text-fg-muted">{shortDate(bug.created_at)}</span></Prop>
          <Prop label="Updated"><span className="text-[12.5px] text-fg-muted">{timeAgo(bug.updated_at)}</span></Prop>
          {bug.fixed_at && <Prop label="Resolved"><span className="text-[12.5px] text-success">{shortDate(bug.fixed_at)}</span></Prop>}
        </aside>
      </div>
    </div>
  );
}

const Labeled = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1"><p className="text-[12px] font-medium text-fg-muted">{label}</p>{children}</div>
);

function TextBlock({ label, text }: { label: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="mt-4">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">{label}</p>
      <p className="selectable whitespace-pre-wrap break-words text-[13px] leading-relaxed">{text}</p>
    </div>
  );
}

const Prop = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1.5"><p className="text-[11.5px] font-medium text-fg-subtle">{label}</p>{children}</div>
);

function Attachments({ bug, canEdit }: { bug: Bug; canEdit: boolean }) {
  const [items, setItems] = useState<(Attachment & { url?: string })[]>([]);
  const [adding, setAdding] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const uid = useSession((s) => s.user?.id);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    const load = async () => {
      const { data } = await supabase.from('bug_attachments').select('*').eq('bug_id', bug.id).order('created_at');
      const rows = (data as Attachment[]) || [];
      const signed = rows.length ? (await supabase.storage.from('attachments').createSignedUrls(rows.map((r) => r.path), 3600)).data ?? [] : [];
      setItems(rows.map((r, i) => ({ ...r, url: signed[i]?.signedUrl ?? undefined })));
    };
    load();
    const ch = supabase.channel(`db:attachments:${bug.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'bug_attachments', filter: `bug_id=eq.${bug.id}` }, load).subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [bug.id]);

  const upload = async () => {
    setUploading(true);
    try {
      for (const f of adding) await uploadAttachment(bug, f);
      setAdding([]);
      toast.success('Attached');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mt-6">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-fg-subtle"><Paperclip className="size-3" /> Attachments {items.length > 0 && <Badge>{items.length}</Badge>}</p>
      {items.length > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          {items.map((a) => (
            <div key={a.id} className="group relative overflow-hidden rounded-lg border border-line bg-raised">
              {a.mime.startsWith('image/') && a.url ? (
                <button className="block aspect-video w-full" onClick={() => setPreview(a.url!)} aria-label={`Preview ${a.name}`}><img src={a.url} alt={a.name} className="size-full object-cover" /></button>
              ) : (
                <div className="grid aspect-video place-items-center text-fg-subtle">{a.mime.startsWith('image/') ? <ImageIcon className="size-5" /> : <FileText className="size-5" />}</div>
              )}
              <div className="flex items-center gap-1 border-t border-line px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-[11.5px]" title={a.name}>{a.name}</span>
                <span className="text-[10.5px] text-fg-subtle">{bytes(a.size)}</span>
                {a.url && <a href={a.url} download={a.name} target="_blank" rel="noreferrer" aria-label={`Download ${a.name}`} className="text-fg-subtle hover:text-fg"><Download className="size-3" /></a>}
                {(a.uploaded_by === uid) && (
                  <button aria-label={`Delete ${a.name}`} className="text-fg-subtle hover:text-danger" onClick={async () => { if (await confirm({ title: `Delete ${a.name}?`, danger: true, confirm: 'Delete' })) { await sb().storage.from('attachments').remove([a.path]); await sb().from('bug_attachments').delete().eq('id', a.id); } }}><Trash2 className="size-3" /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <>
          <FilePicker files={adding} onChange={setAdding} />
          {adding.length > 0 && <div className="mt-2 flex justify-end"><Button size="sm" variant="primary" loading={uploading} onClick={upload}>Upload {adding.length} file{adding.length > 1 ? 's' : ''}</Button></div>}
        </>
      )}
      {preview && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/80 p-8 animate-fade-in" onClick={() => setPreview(null)} role="dialog" aria-label="Image preview">
          <img src={preview} alt="" className="max-h-full max-w-full rounded-lg shadow-pop" />
        </div>
      )}
    </div>
  );
}

