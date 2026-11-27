import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Calendar, CheckSquare, Plus, Trash2, X } from 'lucide-react';
import { Button, EmptyState, IconButton, Input, Select, Sheet, Textarea, confirm } from './ui';
import { MemberSelect, PRIORITIES, TASK_STATUSES, UserAvatar, UserChip } from './common';
import { Comments } from './comments';
import { createTask, deleteTask, updateTask } from '@/lib/actions';
import { cn, shortDate } from '@/lib/format';
import { useWorkspace } from '@/store/workspace';
import type { Task, TaskPriority, TaskStatus } from '@/lib/types';

/** Kanban board for a project's tasks. Drag cards between columns; changes sync live. */
export function TaskBoard({ projectId, canEdit, canComment, openTaskId, onOpenTask }: { projectId: string; canEdit: boolean; canComment: boolean; openTaskId?: string | null; onOpenTask: (id: string | null) => void }) {
  const tasks = useWorkspace((s) => s.tasks.filter((t) => t.project_id === projectId));
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [quick, setQuick] = useState<Record<string, string>>({});

  const drop = async (status: TaskStatus) => {
    const id = drag;
    setDrag(null);
    setOver(null);
    const t = tasks.find((x) => x.id === id);
    if (!t || t.status === status) return;
    const col = tasks.filter((x) => x.status === status);
    try {
      await updateTask(t.id, { status, position: (col.reduce((m, x) => Math.max(m, x.position), 0) || 0) + 1 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const add = async (status: TaskStatus) => {
    const title = quick[status]?.trim();
    if (!title) return;
    setQuick((q) => ({ ...q, [status]: '' }));
    try {
      await createTask({ project_id: projectId, title, status });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        {TASK_STATUSES.map((col) => {
          const items = tasks.filter((t) => t.status === col.value).sort((a, b) => a.position - b.position);
          return (
            <section
              key={col.value}
              aria-label={col.label}
              onDragOver={(e) => { if (canEdit && drag) { e.preventDefault(); setOver(col.value); } }}
              onDragLeave={() => setOver(null)}
              onDrop={() => drop(col.value)}
              className={cn('flex min-h-[320px] flex-col rounded-lg border bg-sunken/60 transition-colors', over === col.value ? 'border-accent bg-accent-soft/30' : 'border-line')}
            >
              <header className="flex items-center gap-2 px-3 py-2.5">
                {col.icon}
                <h3 className="text-[12.5px] font-semibold">{col.label}</h3>
                <span className="tabular text-[12px] text-fg-subtle">{items.length}</span>
              </header>
              <div className="flex flex-1 flex-col gap-1.5 px-2 pb-2">
                {items.map((t) => (
                  <TaskCard key={t.id} task={t} draggable={canEdit} onDragStart={() => setDrag(t.id)} onDragEnd={() => { setDrag(null); setOver(null); }} onOpen={() => onOpenTask(t.id)} dragging={drag === t.id} />
                ))}
                {canEdit && (
                  <div className="mt-1 flex items-center gap-1">
                    <Input value={quick[col.value] ?? ''} onChange={(e) => setQuick((q) => ({ ...q, [col.value]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && add(col.value)} placeholder="Add a task…" className="h-7 border-transparent bg-transparent hover:border-line-strong" aria-label={`Add task to ${col.label}`} />
                    {quick[col.value]?.trim() && <IconButton label="Add task" size="sm" onClick={() => add(col.value)}><Plus className="size-3.5" /></IconButton>}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {tasks.length === 0 && !canEdit && <EmptyState compact icon={<CheckSquare />} title="No tasks yet" />}
      <Sheet open={!!openTaskId} onOpenChange={(o) => !o && onOpenTask(null)} width={600} label="Task details">
        {openTaskId && <TaskDetail taskId={openTaskId} canEdit={canEdit} canComment={canComment} onClose={() => onOpenTask(null)} />}
      </Sheet>
    </>
  );
}

function TaskCard({ task, draggable, onDragStart, onDragEnd, onOpen, dragging }: { task: Task; draggable: boolean; onDragStart: () => void; onDragEnd: () => void; onOpen: () => void; dragging: boolean }) {
  const pr = PRIORITIES.find((p) => p.value === task.priority)!;
  const overdue = task.due_date && task.status !== 'done' && new Date(task.due_date + 'T23:59:59') < new Date();
  return (
    <button
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={cn('group flex flex-col gap-2 rounded-md border border-line bg-panel p-2.5 text-left shadow-sm transition-[border-color,opacity,transform] duration-150 hover:border-line-strong', dragging && 'opacity-40', draggable && 'active:cursor-grabbing')}
    >
      <span className={cn('text-[13px] leading-snug', task.status === 'done' && 'text-fg-muted line-through decoration-fg-subtle/50')}>{task.title}</span>
      <span className="flex items-center gap-2">
        {task.priority !== 'none' && <span title={pr.label}>{pr.icon}</span>}
        {task.due_date && <span className={cn('inline-flex items-center gap-1 text-[11.5px]', overdue ? 'text-danger' : 'text-fg-subtle')}><Calendar className="size-3" />{new Date(task.due_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
        <span className="ml-auto"><UserAvatar userId={task.assignee_id} size={18} /></span>
      </span>
    </button>
  );
}

function TaskDetail({ taskId, canEdit, canComment, onClose }: { taskId: string; canEdit: boolean; canComment: boolean; onClose: () => void }) {
  const task = useWorkspace((s) => s.tasks.find((t) => t.id === taskId));
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDesc(task.description);
    }
  }, [task?.id, task?.title, task?.description]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!task) return <EmptyState icon={<CheckSquare />} title="Task not found" body="It may have been deleted." action={<Button onClick={onClose}>Close</Button>} />;
  const set = async (patch: Partial<Task>) => {
    try {
      await updateTask(task.id, patch);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <CheckSquare className="size-4 text-fg-muted" />
        <span className="text-[12.5px] text-fg-muted">Task</span>
        <div className="ml-auto flex gap-1">
          {canEdit && <IconButton label="Delete task" onClick={async () => { if (await confirm({ title: 'Delete this task?', danger: true, confirm: 'Delete' })) { await deleteTask(task.id); onClose(); } }}><Trash2 className="size-3.5" /></IconButton>}
          <IconButton label="Close" onClick={onClose}><X className="size-3.5" /></IconButton>
        </div>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <Input value={title} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== task.title && set({ title: title.trim() })} className="h-9 border-transparent bg-transparent text-[16px] font-semibold hover:border-line-strong" aria-label="Task title" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Status" size="sm" value={task.status} onChange={(v: TaskStatus) => set({ status: v })} options={TASK_STATUSES} disabled={!canEdit} />
          <Select label="Priority" size="sm" value={task.priority} onChange={(v: TaskPriority) => set({ priority: v })} options={PRIORITIES} disabled={!canEdit} />
          {canEdit ? <MemberSelect value={task.assignee_id} onChange={(v) => set({ assignee_id: v })} size="sm" /> : <UserChip userId={task.assignee_id} />}
          <Input type="date" value={task.due_date ?? ''} disabled={!canEdit} onChange={(e) => set({ due_date: e.target.value || null })} className="h-7" aria-label="Due date" />
        </div>
        <Textarea value={desc} disabled={!canEdit} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== task.description && set({ description: desc })} placeholder="Add details…" rows={5} aria-label="Description" />
        <p className="text-[11.5px] text-fg-subtle">Created {shortDate(task.created_at)} by <UserChip userId={task.created_by} size={14} />{task.completed_at && ` · completed ${shortDate(task.completed_at)}`}</p>
        <div className="border-t border-line pt-4">
          <h4 className="mb-3 text-[12.5px] font-semibold">Discussion</h4>
          <Comments projectId={task.project_id} entityType="task" entityId={task.id} canComment={canComment} />
        </div>
      </div>
    </div>
  );
}
