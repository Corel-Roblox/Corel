// Script library with a shared Luau editor.
// Collaboration model:
//  - Presence on "team:<id>:script:<scriptId>" shows who has the script open, the line
//    they're on and whether they have unsaved changes.
//  - Saves go through save_script(), which only succeeds if nobody saved since you
//    loaded; otherwise you get a conflict with a diff and choose what to keep.
//  - A teammate's save arrives over Realtime: applied instantly if you have no unsaved
//    edits, otherwise shown as a banner. Every save is kept in version history.
//  - Unsaved drafts are kept locally so a crash or restart doesn't lose work.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { AlertTriangle, Check, ChevronRight, Clock, Code2, Copy, CopyPlus, Folder, FolderPlus, GitCompare, History, Lock, MoreHorizontal, Pencil, Plus, Search, Share2, Sparkles, Star, Tag, Trash2, Users, Wand2, X } from 'lucide-react';
import { Badge, Button, Dialog, EmptyState, Field, IconButton, Input, Kbd, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Notice, Popover, PopoverContent, PopoverTrigger, Select, Sheet, Textarea, Tooltip, confirm } from '@/components/ui';
import { ProjectThumb, UserAvatar, UserName } from '@/components/common';
import { CodeEditor } from '@/components/CodeEditor';
import { DiffView } from '@/components/DiffView';
import { SCRIPT_CATEGORIES } from '@/components/dialogs/CreateDialogs';
import { createScript, deleteScript, saveScript, ScriptConflict, toggleFavorite, updateScriptMeta } from '@/lib/actions';
import { formatLuau } from '@/lib/luau';
import { getSupabase, must, sb } from '@/lib/supabase';
import { cn, modKey, timeAgo } from '@/lib/format';
import { hasPerm } from '@/lib/perms';
import { useUI } from '@/store/ui';
import { displayName, useMe, useWorkspace } from '@/store/workspace';
import { useSession } from '@/store/session';
import type { Script, ScriptVersion } from '@/lib/types';

type Filter = 'all' | 'favorites' | 'recent' | 'mine' | 'shared' | `folder:${string}` | `cat:${string}` | `tag:${string}`;

export function ScriptsPage() {
  const { scriptId } = useParams();
  const navigate = useNavigate();
  const scripts = useWorkspace((s) => s.scripts);
  const folders = useWorkspace((s) => s.folders);
  const favorites = useWorkspace((s) => s.favorites);
  const uid = useSession((s) => s.user?.id);
  const me = useMe();
  const openCreate = useUI((s) => s.openCreate);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const canEdit = hasPerm(me, 'manage_scripts');

  const tags = useMemo(() => [...new Set(scripts.flatMap((s) => s.tags))].sort(), [scripts]);
  const categories = useMemo(() => [...new Set(scripts.map((s) => s.category))].sort(), [scripts]);
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    let l = scripts;
    if (filter === 'favorites') l = l.filter((s) => favorites.includes(s.id));
    else if (filter === 'mine') l = l.filter((s) => s.created_by === uid);
    else if (filter === 'shared') l = l.filter((s) => s.visibility === 'projects');
    else if (filter === 'recent') l = [...l].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 15);
    else if (filter.startsWith('folder:')) l = l.filter((s) => s.folder_id === filter.slice(7));
    else if (filter.startsWith('cat:')) l = l.filter((s) => s.category === filter.slice(4));
    else if (filter.startsWith('tag:')) l = l.filter((s) => s.tags.includes(filter.slice(4)));
    if (term) l = l.filter((s) => s.name.toLowerCase().includes(term) || s.description.toLowerCase().includes(term) || s.tags.some((t) => t.includes(term)) || s.content.toLowerCase().includes(term));
    return filter === 'recent' ? l : [...l].sort((a, b) => a.name.localeCompare(b.name));
  }, [scripts, q, filter, favorites, uid]);

  const selected = scripts.find((s) => s.id === scriptId);

  return (
    <div className="flex h-full">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-sunken/40">
        <div className="flex items-center justify-between px-4 pb-2 pt-5">
          <h1 className="text-[15px] font-semibold">Scripts</h1>
          <div className="flex gap-0.5">
            <FolderDialog disabled={!canEdit} />
            <Tooltip content="New script (C)"><IconButton label="New script" disabled={!canEdit} onClick={() => openCreate('script')}><Plus className="size-4" /></IconButton></Tooltip>
          </div>
        </div>
        <div className="px-3 pb-2"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names, tags and code…" icon={<Search />} className="h-7" aria-label="Search scripts" /></div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          <nav className="mb-2 space-y-px" aria-label="Script filters">
            <FilterItem active={filter === 'all'} onClick={() => setFilter('all')} icon={<Code2 />} label="All scripts" count={scripts.length} />
            <FilterItem active={filter === 'favorites'} onClick={() => setFilter('favorites')} icon={<Star />} label="Favorites" count={favorites.length} />
            <FilterItem active={filter === 'recent'} onClick={() => setFilter('recent')} icon={<Clock />} label="Recently edited" />
            <FilterItem active={filter === 'mine'} onClick={() => setFilter('mine')} icon={<Pencil />} label="Created by me" />
            <FilterItem active={filter === 'shared'} onClick={() => setFilter('shared')} icon={<Share2 />} label="Shared with projects" />
          </nav>
          {folders.length > 0 && (
            <Group label="Folders">
              {folders.map((f) => (
                <FolderItem key={f.id} id={f.id} name={f.name} active={filter === `folder:${f.id}`} onClick={() => setFilter(`folder:${f.id}`)} count={scripts.filter((s) => s.folder_id === f.id).length} canEdit={canEdit} onDeleted={() => setFilter('all')} />
              ))}
            </Group>
          )}
          {categories.length > 0 && (
            <Group label="Categories">
              {categories.map((c) => <FilterItem key={c} active={filter === `cat:${c}`} onClick={() => setFilter(`cat:${c}`)} icon={<ChevronRight />} label={c} count={scripts.filter((s) => s.category === c).length} />)}
            </Group>
          )}
          {tags.length > 0 && (
            <Group label="Tags">
              <div className="flex flex-wrap gap-1 px-2">
                {tags.map((t) => (
                  <button key={t} onClick={() => setFilter(filter === `tag:${t}` ? 'all' : `tag:${t}`)} className={cn('rounded-[5px] px-1.5 py-0.5 text-[11.5px] transition-colors', filter === `tag:${t}` ? 'bg-accent-soft text-accent-text' : 'bg-active text-fg-muted hover:text-fg')}>#{t}</button>
                ))}
              </div>
            </Group>
          )}
          <Group label={`${list.length} script${list.length === 1 ? '' : 's'}`}>
            {list.length === 0 ? (
              <p className="px-2 py-2 text-[12.5px] text-fg-subtle">{scripts.length ? 'Nothing matches.' : 'No scripts yet.'}</p>
            ) : (
              list.map((s) => <ScriptItem key={s.id} s={s} active={s.id === scriptId} fav={favorites.includes(s.id)} onClick={() => navigate(`/scripts/${s.id}`)} />)
            )}
          </Group>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        {selected ? (
          <ScriptEditor key={selected.id} script={selected} canEdit={canEdit} />
        ) : (
          <div className="grid h-full place-items-center">
            <EmptyState icon={<Code2 />} title={scriptId ? 'Script not found' : 'Your team’s Luau library'} body={scriptId ? 'It may have been deleted, or it isn’t shared with you.' : 'Save reusable modules, snippets and systems. Share them with the whole team or specific projects, edit together, and roll back with version history.'} action={canEdit && <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => openCreate('script')}>New script</Button>} />
          </div>
        )}
      </div>
    </div>
  );
}

const Group = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="mt-3"><p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">{label}</p><div className="space-y-px">{children}</div></div>
);

function FilterItem({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button onClick={onClick} className={cn('flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] transition-colors [&>svg]:size-3.5', active ? 'bg-active text-fg [&>svg]:text-accent-text' : 'text-fg-muted hover:bg-hover hover:text-fg [&>svg]:text-fg-subtle')}>
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="tabular text-[11px] text-fg-subtle">{count}</span>}
    </button>
  );
}

function FolderItem({ id, name, active, onClick, count, canEdit, onDeleted }: { id: string; name: string; active: boolean; onClick: () => void; count: number; canEdit: boolean; onDeleted: () => void }) {
  return (
    <div className="group relative">
      <FilterItem active={active} onClick={onClick} icon={<Folder />} label={name} count={count} />
      {canEdit && (
        <Menu>
          <MenuTrigger asChild><button aria-label={`Folder ${name} actions`} className="absolute right-1 top-1 grid size-5 place-items-center rounded text-fg-subtle opacity-0 hover:bg-active group-hover:opacity-100 focus-visible:opacity-100"><MoreHorizontal className="size-3.5" /></button></MenuTrigger>
          <MenuContent>
            <MenuItem icon={<Pencil />} onSelect={async () => { const n = window.prompt('Rename folder', name); if (n?.trim()) must(await sb().from('script_folders').update({ name: n.trim() }).eq('id', id)); }}>Rename</MenuItem>
            <MenuItem icon={<Trash2 />} danger onSelect={async () => { if (await confirm({ title: `Delete folder “${name}”?`, body: 'Scripts inside are kept and moved out of the folder.', danger: true, confirm: 'Delete folder' })) { must(await sb().from('script_folders').delete().eq('id', id)); onDeleted(); } }}>Delete folder</MenuItem>
          </MenuContent>
        </Menu>
      )}
    </div>
  );
}

function FolderDialog({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const teamId = useWorkspace((s) => s.teamId);
  const create = async () => {
    try {
      must(await sb().from('script_folders').insert({ team_id: teamId, name: name.trim() }));
      setOpen(false);
      setName('');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen} title="New folder" width={380} trigger={<IconButton label="New folder" disabled={disabled}><FolderPlus className="size-4" /></IconButton>}
      footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={create}>Create</Button></>}>
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()} autoFocus placeholder="Combat" /></Field>
    </Dialog>
  );
}

function ScriptItem({ s, active, fav, onClick }: { s: Script; active: boolean; fav: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn('flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors', active ? 'bg-active' : 'hover:bg-hover')}>
      <span className="flex items-center gap-1.5">
        <Code2 className="size-3.5 shrink-0 text-fg-subtle" />
        <span className="flex-1 truncate text-[13px]">{s.name}</span>
        {fav && <Star className="size-3 fill-warning text-warning" />}
        {s.visibility === 'private' && <Lock className="size-3 text-fg-subtle" />}
        {s.visibility === 'projects' && <Share2 className="size-3 text-fg-subtle" />}
      </span>
      <span className="truncate pl-5 text-[11.5px] text-fg-subtle">{s.category} · v{s.version} · {timeAgo(s.updated_at)}</span>
    </button>
  );
}

// ------------------------------------------------------------------ editor

interface EditorPresence {
  user_id: string;
  line: number;
  dirty: boolean;
}

function draftKey(id: string) {
  return `corel.draft.${id}`;
}

function ScriptEditor({ script, canEdit }: { script: Script; canEdit: boolean }) {
  const navigate = useNavigate();
  const uid = useSession((s) => s.user?.id);
  const teamId = useWorkspace((s) => s.teamId);
  const profiles = useWorkspace((s) => s.profiles);
  const favorites = useWorkspace((s) => s.favorites);
  const me = useMe();
  const saved = (() => {
    try {
      const d = JSON.parse(localStorage.getItem(draftKey(script.id)) || 'null');
      return d && d.base === script.version && d.content !== script.content ? (d.content as string) : null;
    } catch {
      return null;
    }
  })();
  const [content, setContent] = useState(saved ?? script.content);
  const [base, setBase] = useState({ version: script.version, content: script.content });
  const [incoming, setIncoming] = useState<Script | null>(null);
  const [conflict, setConflict] = useState<Script | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [peers, setPeers] = useState<EditorPresence[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const line = useRef(1);
  const channel = useRef<RealtimeChannel | null>(null);
  const dirty = content !== base.content;
  const restored = useRef(!!saved);

  useEffect(() => {
    if (restored.current) toast('Restored your unsaved changes', { description: 'They were kept from your last session.' });
  }, []);

  // Keep a local draft of unsaved work.
  useEffect(() => {
    if (dirty) localStorage.setItem(draftKey(script.id), JSON.stringify({ base: base.version, content }));
    else localStorage.removeItem(draftKey(script.id));
  }, [content, dirty, base.version, script.id]);

  // A newer version arrived (teammate saved).
  useEffect(() => {
    if (script.version <= base.version) return;
    if (!dirty) {
      setContent(script.content);
      setBase({ version: script.version, content: script.content });
      if (script.updated_by !== uid) toast(`${displayName(profiles[script.updated_by ?? ''], 'A teammate')} saved v${script.version}`, { description: 'The editor now shows their changes.' });
    } else if (script.updated_by !== uid) {
      setIncoming(script);
    }
  }, [script.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Presence: who else has this script open.
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase || !teamId || !uid) return;
    const ch = supabase.channel(`team:${teamId}:script:${script.id}`, { config: { private: true, presence: { key: uid } } });
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState<EditorPresence>();
      setPeers(Object.entries(st).filter(([k]) => k !== uid).map(([k, v]) => ({ ...v[v.length - 1], user_id: k })));
    });
    ch.subscribe(async (s) => {
      if (s === 'SUBSCRIBED') await ch.track({ line: line.current, dirty: false });
    });
    channel.current = ch;
    return () => {
      supabase.removeChannel(ch);
      channel.current = null;
    };
  }, [script.id, teamId, uid]);

  const lastTrack = useRef(0);
  const track = (patch: Partial<EditorPresence>) => {
    if (Date.now() - lastTrack.current < 400 && patch.dirty === undefined) return;
    lastTrack.current = Date.now();
    channel.current?.track({ line: line.current, dirty, ...patch });
  };
  useEffect(() => track({ dirty }), [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (opts: { force?: boolean } = {}) => {
    if (!canEdit || (!dirty && !opts.force)) return;
    setSaving(true);
    const baseVersion = opts.force && (conflict || incoming) ? (conflict ?? incoming)!.version : base.version;
    try {
      const row = await saveScript(script.id, content, baseVersion, message.trim());
      setBase({ version: row.version, content: row.content });
      setIncoming(null);
      setConflict(null);
      setMessage('');
      toast.success(`Saved v${row.version}`);
    } catch (e) {
      if (e instanceof ScriptConflict) {
        const { data } = await sb().from('scripts').select('*').eq('id', script.id).single();
        setConflict(data as Script);
      } else toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const takeTheirs = (s: Script) => {
    setContent(s.content);
    setBase({ version: s.version, content: s.content });
    setIncoming(null);
    setConflict(null);
  };

  const fav = favorites.includes(script.id);
  const other = conflict ?? incoming;
  const editingPeers = peers.filter((p) => p.dirty);

  return (
    <div className="flex h-full flex-col">
      <ScriptHeader script={script} canEdit={canEdit} fav={fav} onHistory={() => setHistoryOpen(true)}
        onDuplicate={async () => { const s = await createScript({ name: `${script.name} copy`, description: script.description, category: script.category, tags: script.tags, content, folder_id: script.folder_id }); navigate(`/scripts/${s.id}`); toast.success('Duplicated'); }}
        onDelete={async () => { if (await confirm({ title: `Delete ${script.name}?`, body: 'The script and all its versions are deleted for everyone.', danger: true, confirm: 'Delete script' })) { await deleteScript(script.id); localStorage.removeItem(draftKey(script.id)); navigate('/scripts'); } }}
        canDelete={script.created_by === uid || me?.role === 'owner' || me?.role === 'admin'}
      />
      {other && (
        <div className={cn('flex items-center gap-3 border-b px-4 py-2 text-[12.5px]', conflict ? 'border-danger/30 bg-danger-soft' : 'border-warning/30 bg-warning-soft')} role="alert">
          <AlertTriangle className={cn('size-4', conflict ? 'text-danger' : 'text-warning')} />
          <span className="flex-1 text-fg">
            <b>{displayName(profiles[other.updated_by ?? ''], 'A teammate')}</b> saved v{other.version} while you were editing.{' '}
            {conflict ? 'Your save was not applied, so nothing was overwritten.' : 'Your unsaved changes are still here.'}
          </span>
          <Button size="sm" variant="ghost" icon={<GitCompare className="size-3.5" />} onClick={() => setCompareOpen(true)}>Compare</Button>
          <Button size="sm" variant="ghost" onClick={() => takeTheirs(other)}>Use theirs</Button>
          <Button size="sm" variant="secondary" onClick={() => save({ force: true })} loading={saving}>Keep mine as v{other.version + 1}</Button>
        </div>
      )}
      <div className="flex items-center gap-2 border-b border-line px-4 py-1.5">
        <span className="flex items-center gap-1.5 text-[12px] text-fg-muted">
          {dirty ? <><span className="size-1.5 rounded-full bg-warning" />Unsaved changes</> : <><Check className="size-3.5 text-success" />Saved · v{base.version}</>}
        </span>
        {peers.length > 0 && (
          <span className="ml-2 flex items-center gap-2 text-[12px] text-fg-muted">
            <span className="flex -space-x-1">{peers.slice(0, 4).map((p) => <Tooltip key={p.user_id} content={`${displayName(profiles[p.user_id])} · line ${p.line}${p.dirty ? ' · editing' : ''}`}><span className="rounded-full ring-2 ring-bg"><UserAvatar userId={p.user_id} size={18} /></span></Tooltip>)}</span>
            {editingPeers.length ? `${editingPeers.map((p) => displayName(profiles[p.user_id])).join(', ')} ${editingPeers.length > 1 ? 'are' : 'is'} editing` : `${peers.length} viewing`}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Tooltip content={`Format (Shift+Alt+F)`}><IconButton label="Format code" disabled={!canEdit} onClick={() => setContent(formatLuau(content))}><Wand2 className="size-3.5" /></IconButton></Tooltip>
          <Tooltip content="Copy code"><IconButton label="Copy code" onClick={() => { navigator.clipboard.writeText(content); toast.success('Copied to clipboard'); }}><Copy className="size-3.5" /></IconButton></Tooltip>
          {canEdit && dirty && <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe this change (optional)" className="h-7 w-[220px]" aria-label="Version message" onKeyDown={(e) => e.key === 'Enter' && save()} />}
          {canEdit ? <Button size="sm" variant="primary" disabled={!dirty} loading={saving} onClick={() => save()}>Save <Kbd>{modKey} S</Kbd></Button> : <Badge><Lock className="size-3" />Read only</Badge>}
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-sunken/30">
        <CodeEditor value={content} onChange={setContent} readOnly={!canEdit} onSave={() => save()} onFormat={() => canEdit && setContent(formatLuau(content))} onCursor={(l) => { line.current = l; track({}); }} />
      </div>
      <HistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} script={script} current={content} canEdit={canEdit} onRestore={(v) => { setContent(v.content); setMessage(`Restored v${v.version}`); setHistoryOpen(false); toast('Loaded v' + v.version + ' into the editor', { description: 'Save to make it the newest version.' }); }} />
      <Dialog open={compareOpen} onOpenChange={setCompareOpen} title={`Your version vs v${other?.version ?? ''}`} description="Red lines are only in their version, green lines only in yours." width={860}>
        {other && <DiffView before={other.content} after={content} className="max-h-[55vh]" />}
      </Dialog>
    </div>
  );
}

function ScriptHeader({ script, canEdit, fav, onHistory, onDuplicate, onDelete, canDelete }: { script: Script; canEdit: boolean; fav: boolean; onHistory: () => void; onDuplicate: () => void; onDelete: () => void; canDelete: boolean }) {
  const [name, setName] = useState(script.name);
  const [desc, setDesc] = useState(script.description);
  const [tagInput, setTagInput] = useState('');
  const folders = useWorkspace((s) => s.folders);
  useEffect(() => {
    setName(script.name);
    setDesc(script.description);
  }, [script.name, script.description]);
  const meta = async (patch: Partial<Script>) => {
    try {
      await updateScriptMeta(script.id, patch);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
    if (t && !script.tags.includes(t)) meta({ tags: [...script.tags, t] });
    setTagInput('');
  };
  return (
    <div className="border-b border-line px-4 pb-2.5 pt-4">
      <div className="flex items-center gap-2">
        <Input value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== script.name && meta({ name: name.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="h-8 max-w-[360px] border-transparent bg-transparent px-1.5 text-[16px] font-semibold hover:border-line-strong" aria-label="Script name" />
        <Tooltip content={fav ? 'Remove from favorites' : 'Add to favorites'}><IconButton label="Favorite" onClick={() => toggleFavorite(script.id)}><Star className={cn('size-4', fav && 'fill-warning text-warning')} /></IconButton></Tooltip>
        <div className="ml-auto flex items-center gap-1.5">
          <SharePopover script={script} canEdit={canEdit} />
          <Button size="sm" variant="ghost" icon={<History className="size-3.5" />} onClick={onHistory}>History</Button>
          <Menu>
            <MenuTrigger asChild><IconButton label="Script actions"><MoreHorizontal className="size-4" /></IconButton></MenuTrigger>
            <MenuContent>
              <MenuItem icon={<CopyPlus />} disabled={!canEdit} onSelect={onDuplicate}>Duplicate</MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} danger disabled={!canDelete} onSelect={onDelete}>Delete script</MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-1.5">
        <div className="w-[120px]"><Select label="Category" size="sm" value={script.category} disabled={!canEdit} onChange={(v) => meta({ category: v })} options={[...new Set([...SCRIPT_CATEGORIES, script.category])].map((c) => ({ value: c, label: c }))} /></div>
        <div className="w-[140px]"><Select label="Folder" size="sm" value={script.folder_id ?? 'none'} disabled={!canEdit} onChange={(v) => meta({ folder_id: v === 'none' ? null : v })} options={[{ value: 'none', label: 'No folder' }, ...folders.map((f) => ({ value: f.id, label: f.name, icon: <Folder className="size-3" /> }))]} /></div>
        {script.tags.map((t) => (
          <span key={t} className="inline-flex h-6 items-center gap-1 rounded-md bg-active px-1.5 text-[11.5px] text-fg-muted">
            #{t}
            {canEdit && <button aria-label={`Remove tag ${t}`} onClick={() => meta({ tags: script.tags.filter((x) => x !== t) })} className="hover:text-fg"><X className="size-3" /></button>}
          </span>
        ))}
        {canEdit && <div className="w-[110px]"><Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} onBlur={addTag} placeholder="Add tag" icon={<Tag />} className="h-6 text-[12px]" aria-label="Add tag" /></div>}
        <span className="ml-auto text-[11.5px] text-fg-subtle">Created by <UserName userId={script.created_by} /> · edited {timeAgo(script.updated_at)} by <UserName userId={script.updated_by} /></span>
      </div>
      <Textarea value={desc} disabled={!canEdit} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== script.description && meta({ description: desc })} placeholder={canEdit ? 'Add a description: what it does, how to use it…' : 'No description'} rows={1} style={{ fieldSizing: 'content' } as React.CSSProperties} className="mt-1.5 !min-h-[30px] max-h-[120px] resize-none border-transparent bg-transparent px-1.5 py-1 text-[12.5px] text-fg-muted hover:border-line-strong" aria-label="Description" />
    </div>
  );
}

function SharePopover({ script, canEdit }: { script: Script; canEdit: boolean }) {
  const projects = useWorkspace((s) => s.projects.filter((p) => !p.archived));
  const label = script.visibility === 'team' ? 'Team' : script.visibility === 'private' ? 'Private' : `${script.shared_project_ids.length} project${script.shared_project_ids.length === 1 ? '' : 's'}`;
  const set = (patch: Partial<Script>) => updateScriptMeta(script.id, patch).catch((e) => toast.error((e as Error).message));
  return (
    <Popover>
      <PopoverTrigger asChild><Button size="sm" variant="ghost" icon={script.visibility === 'private' ? <Lock className="size-3.5" /> : script.visibility === 'team' ? <Users className="size-3.5" /> : <Share2 className="size-3.5" />}>{label}</Button></PopoverTrigger>
      <PopoverContent className="w-[300px] p-3">
        <p className="mb-2 text-[12.5px] font-semibold">Who can see this script</p>
        <div className="space-y-1">
          {([
            ['team', 'Everyone in the team', <Users key="u" className="size-3.5" />],
            ['projects', 'Members of selected projects', <Share2 key="s" className="size-3.5" />],
            ['private', 'Only me (and team admins)', <Lock key="l" className="size-3.5" />],
          ] as const).map(([v, l, icon]) => (
            <button key={v} disabled={!canEdit} onClick={() => set({ visibility: v })} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] disabled:opacity-50', script.visibility === v ? 'bg-accent-soft text-accent-text' : 'hover:bg-hover')}>
              {icon}<span className="flex-1">{l}</span>{script.visibility === v && <Check className="size-3.5" />}
            </button>
          ))}
        </div>
        {script.visibility === 'projects' && (
          <div className="mt-3 max-h-[180px] space-y-0.5 overflow-y-auto border-t border-line pt-2">
            {projects.map((p) => {
              const on = script.shared_project_ids.includes(p.id);
              return (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[12.5px] hover:bg-hover">
                  <input type="checkbox" disabled={!canEdit} checked={on} onChange={() => set({ shared_project_ids: on ? script.shared_project_ids.filter((x) => x !== p.id) : [...script.shared_project_ids, p.id] })} className="accent-[var(--accent)]" />
                  <ProjectThumb project={p} size={16} />
                  <span className="truncate">{p.name}</span>
                </label>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function HistorySheet({ open, onClose, script, current, canEdit, onRestore }: { open: boolean; onClose: () => void; script: Script; current: string; canEdit: boolean; onRestore: (v: ScriptVersion) => void }) {
  const [versions, setVersions] = useState<ScriptVersion[] | null>(null);
  const [sel, setSel] = useState<ScriptVersion | null>(null);
  useEffect(() => {
    if (!open) return;
    setVersions(null);
    sb().from('script_versions').select('*').eq('script_id', script.id).order('version', { ascending: false }).limit(200).then(({ data }) => {
      const v = (data as ScriptVersion[]) || [];
      setVersions(v);
      setSel(v[1] ?? v[0] ?? null);
    });
  }, [open, script.id, script.version]);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} width={980} label="Version history">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <History className="size-4 text-fg-muted" />
        <h2 className="flex-1 text-[14px] font-semibold">Version history · {script.name}</h2>
        <IconButton label="Close" onClick={onClose}><X className="size-3.5" /></IconButton>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]">
        <ul className="overflow-y-auto border-r border-line p-2">
          {versions === null ? <li className="p-2 text-[12.5px] text-fg-subtle">Loading…</li> : versions.map((v) => (
            <li key={v.id}>
              <button onClick={() => setSel(v)} className={cn('flex w-full items-start gap-2 rounded-md px-2 py-2 text-left', sel?.id === v.id ? 'bg-active' : 'hover:bg-hover')}>
                <UserAvatar userId={v.edited_by} size={20} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-medium">v{v.version}{v.version === script.version && <Badge tone="accent">Current</Badge>}</span>
                  <span className="block truncate text-[11.5px] text-fg-muted">{v.message || 'No description'}</span>
                  <span className="block text-[11px] text-fg-subtle"><UserName userId={v.edited_by} /> · {timeAgo(v.created_at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex min-h-0 flex-col p-4">
          {sel ? (
            <>
              <div className="mb-3 flex items-center gap-2">
                <p className="flex-1 text-[12.5px] text-fg-muted">Changes from <b className="text-fg">v{sel.version}</b> to what’s in your editor</p>
                <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => { navigator.clipboard.writeText(sel.content); toast.success('Copied v' + sel.version); }}>Copy v{sel.version}</Button>
                {canEdit && <Button size="sm" variant="primary" icon={<Sparkles className="size-3.5" />} onClick={() => onRestore(sel)}>Restore v{sel.version}</Button>}
              </div>
              <DiffView before={sel.content} after={current} className="min-h-0 flex-1" />
            </>
          ) : <Notice>No versions yet.</Notice>}
        </div>
      </div>
    </Sheet>
  );
}
