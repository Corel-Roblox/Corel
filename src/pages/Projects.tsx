import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, Bug, CheckSquare, FolderKanban, LayoutGrid, List, Plus, Rocket, Search, Users } from 'lucide-react';
import { Page } from '@/components/layout/Shell';
import { Badge, Button, EmptyState, Input, PageHeader, Segmented } from '@/components/ui';
import { PresenceStack, ProjectThumb, isOpenBug } from '@/components/common';
import { useUI } from '@/store/ui';
import { useMe, useWorkspace } from '@/store/workspace';
import { hasPerm } from '@/lib/perms';
import { countdown, timeAgo } from '@/lib/format';
import { useNow } from '@/components/activity';
import type { Project } from '@/lib/types';

export function ProjectsPage() {
  const projects = useWorkspace((s) => s.projects);
  const me = useMe();
  const openCreate = useUI((s) => s.openCreate);
  const [q, setQ] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [showArchived, setShowArchived] = useState(false);
  const list = useMemo(() => projects.filter((p) => (showArchived ? p.archived : !p.archived)).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.universe_id?.includes(q)), [projects, q, showArchived]);
  const archivedCount = projects.filter((p) => p.archived).length;

  return (
    <Page wide>
      <PageHeader
        title="Projects"
        description="Every Roblox experience your team works on, each with its own workspace."
        actions={hasPerm(me, 'manage_projects') && <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => openCreate('project')}>New project</Button>}
      />
      <div className="mb-4 flex items-center gap-2">
        <div className="w-[280px]"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects or universe IDs…" icon={<Search />} aria-label="Search projects" /></div>
        {archivedCount > 0 && <Button variant={showArchived ? 'secondary' : 'ghost'} size="sm" icon={<Archive className="size-3.5" />} onClick={() => setShowArchived(!showArchived)}>Archived ({archivedCount})</Button>}
        <div className="ml-auto"><Segmented label="View" value={view} onChange={setView} options={[{ value: 'grid', label: 'Grid', icon: <LayoutGrid className="size-3" /> }, { value: 'list', label: 'List', icon: <List className="size-3" /> }]} /></div>
      </div>
      {list.length === 0 ? (
        <div className="rounded-lg border border-line bg-panel">
          <EmptyState
            icon={<FolderKanban />}
            title={projects.length ? 'No projects match' : 'Create your first project'}
            body={projects.length ? 'Try a different search.' : 'Add a Roblox experience by pasting its link. Corel fetches the name, IDs and icon automatically.'}
            action={!projects.length && hasPerm(me, 'manage_projects') && <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => openCreate('project')}>New project</Button>}
          />
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {list.map((p) => <ProjectCard key={p.id} project={p} />)}
        </div>
      ) : (
        <div className="divide-y divide-line rounded-lg border border-line bg-panel">
          {list.map((p) => <ProjectRow key={p.id} project={p} />)}
        </div>
      )}
    </Page>
  );
}

function useProjectStats(p: Project) {
  const bugs = useWorkspace((s) => s.bugs.filter((b) => b.project_id === p.id && isOpenBug(b.status)).length);
  const tasks = useWorkspace((s) => s.tasks.filter((t) => t.project_id === p.id));
  const update = useWorkspace((s) => s.publish.find((u) => u.project_id === p.id && ['preparing', 'scheduled', 'restoring'].includes(u.status)));
  const done = tasks.filter((t) => t.status === 'done').length;
  return { bugs, tasks: tasks.length, done, update };
}

function ProjectCard({ project: p }: { project: Project }) {
  const s = useProjectStats(p);
  const now = useNow(30_000);
  return (
    <Link to={`/projects/${p.id}`} className="group flex flex-col gap-3 rounded-lg border border-line bg-panel p-4 transition-[border-color,background-color] duration-150 hover:border-line-strong hover:bg-raised">
      <div className="flex items-start gap-3">
        <ProjectThumb project={p} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{p.name}</p>
          <p className="truncate font-mono text-[11.5px] text-fg-subtle">{p.universe_id ? `Universe ${p.universe_id}` : 'No experience linked'}</p>
        </div>
        <PresenceStack filter={(x) => x.project_id === p.id} size={20} max={3} />
      </div>
      <p className="line-clamp-2 min-h-[36px] text-[12.5px] text-fg-muted">{p.description || 'No description yet.'}</p>
      <div className="flex items-center gap-3 text-[12px] text-fg-muted">
        <span className="inline-flex items-center gap-1"><Bug className="size-3.5 text-fg-subtle" />{s.bugs} open</span>
        <span className="inline-flex items-center gap-1"><CheckSquare className="size-3.5 text-fg-subtle" />{s.done}/{s.tasks}</span>
        {p.visibility === 'members' && <span className="inline-flex items-center gap-1"><Users className="size-3.5 text-fg-subtle" />Members only</span>}
        <span className="ml-auto text-fg-subtle">{timeAgo(p.updated_at)}</span>
      </div>
      {s.update && (
        <div className="flex items-center gap-2 rounded-md bg-accent-soft px-2.5 py-1.5 text-[12px] text-accent-text">
          <Rocket className="size-3.5" />
          Update in <span className="tabular font-semibold">{countdown(new Date(s.update.update_at).getTime() - now)}</span>
        </div>
      )}
    </Link>
  );
}

function ProjectRow({ project: p }: { project: Project }) {
  const s = useProjectStats(p);
  return (
    <Link to={`/projects/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-hover">
      <ProjectThumb project={p} size={28} />
      <span className="w-[240px] truncate text-[13px] font-medium">{p.name}</span>
      <span className="w-[160px] truncate font-mono text-[11.5px] text-fg-subtle">{p.universe_id ?? '—'}</span>
      <span className="flex-1 truncate text-[12.5px] text-fg-muted">{p.description}</span>
      {s.update && <Badge tone="accent"><Rocket className="size-3" />Scheduled</Badge>}
      <span className="w-[70px] text-[12px] text-fg-muted">{s.bugs} bugs</span>
      <span className="w-[70px] text-[12px] text-fg-muted">{s.done}/{s.tasks} tasks</span>
      <PresenceStack filter={(x) => x.project_id === p.id} size={18} max={3} />
    </Link>
  );
}
