// Real-time comment thread for a bug or task. New comments from teammates arrive
// through a Realtime subscription filtered to this item; typing indicators use a
// broadcast on the team's private channel.
import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Pencil, Send, Trash2 } from 'lucide-react';
import { Button, IconButton, Textarea, confirm } from './ui';
import { UserAvatar, UserName } from './common';
import { getSupabase, must, sb } from '@/lib/supabase';
import { addComment } from '@/lib/actions';
import { cn, modKey, timeAgo } from '@/lib/format';
import { useSession } from '@/store/session';
import { displayName, useWorkspace } from '@/store/workspace';
import type { Comment } from '@/lib/types';
import { toast } from 'sonner';

export function Comments({ projectId, entityType, entityId, canComment }: { projectId: string; entityType: 'bug' | 'task'; entityId: string; canComment: boolean }) {
  const [items, setItems] = useState<Comment[] | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [typing, setTyping] = useState<Record<string, number>>({});
  const uid = useSession((s) => s.user?.id);
  const teamId = useWorkspace((s) => s.teamId);
  const profiles = useWorkspace((s) => s.profiles);
  const typingCh = useRef<RealtimeChannel | null>(null);
  const lastTyping = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    let cancelled = false;
    setItems(null);
    supabase
      .from('comments')
      .select('*')
      .eq('entity_id', entityId)
      .order('created_at')
      .then(({ data }) => !cancelled && setItems((data as Comment[]) || []));
    const ch = supabase
      .channel(`db:comments:${entityId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `entity_id=eq.${entityId}` }, (p) => {
        setItems((prev) => {
          const list = prev ?? [];
          if (p.eventType === 'DELETE') return list.filter((c) => c.id !== (p.old as Comment).id);
          const c = p.new as Comment;
          return list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c];
        });
      })
      .subscribe();
    const tch = teamId
      ? supabase
          .channel(`team:${teamId}:typing:${entityId}`, { config: { private: true } })
          .on('broadcast', { event: 'typing' }, ({ payload }) => {
            if (payload.user_id !== uid) setTyping((t) => ({ ...t, [payload.user_id]: Date.now() }));
          })
          .subscribe()
      : null;
    typingCh.current = tch;
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
      if (tch) supabase.removeChannel(tch);
    };
  }, [entityId, teamId, uid]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [items?.length]);

  useEffect(() => {
    const t = window.setInterval(() => setTyping((m) => Object.fromEntries(Object.entries(m).filter(([, at]) => Date.now() - at < 4000))), 1500);
    return () => window.clearInterval(t);
  }, []);

  const onType = (v: string) => {
    setBody(v);
    if (Date.now() - lastTyping.current > 2000) {
      lastTyping.current = Date.now();
      typingCh.current?.send({ type: 'broadcast', event: 'typing', payload: { user_id: uid } });
    }
  };

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await addComment(projectId, entityType, entityId, body);
      setBody('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const typers = Object.keys(typing);

  return (
    <div className="flex flex-col gap-3">
      {items === null ? (
        <p className="text-[12.5px] text-fg-subtle">Loading comments…</p>
      ) : items.length === 0 ? (
        <p className="text-[12.5px] text-fg-subtle">No comments yet. Start the discussion.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((c) => (
            <li key={c.id} className="group flex gap-2.5 animate-fade-in">
              <UserAvatar userId={c.author_id} size={24} presence />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[12px]">
                  <UserName userId={c.author_id} className="font-medium text-fg" />
                  <span className="text-fg-subtle">{timeAgo(c.created_at)}{c.edited_at && ' · edited'}</span>
                  {c.author_id === uid && editing !== c.id && (
                    <span className="ml-auto flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <IconButton size="xs" label="Edit comment" onClick={() => { setEditing(c.id); setEditBody(c.body); }}><Pencil className="size-3" /></IconButton>
                      <IconButton size="xs" label="Delete comment" onClick={async () => { if (await confirm({ title: 'Delete this comment?', danger: true, confirm: 'Delete' })) must(await sb().from('comments').delete().eq('id', c.id)); }}><Trash2 className="size-3" /></IconButton>
                    </span>
                  )}
                </div>
                {editing === c.id ? (
                  <div className="mt-1 space-y-2">
                    <Textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} autoFocus />
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                      <Button size="sm" variant="primary" disabled={!editBody.trim()} onClick={async () => { try { must(await sb().from('comments').update({ body: editBody.trim(), edited_at: new Date().toISOString() }).eq('id', c.id)); setEditing(null); } catch (e) { toast.error((e as Error).message); } }}>Save</Button>
                    </div>
                  </div>
                ) : (
                  <p className="selectable mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg">{c.body}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div ref={endRef} />
      {canComment ? (
        <div className="rounded-lg border border-line-strong bg-sunken focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft">
          <Textarea
            value={body}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Write a comment…"
            className="min-h-[64px] border-0 bg-transparent focus:ring-0"
            aria-label="Write a comment"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <span className={cn('text-[11.5px] text-fg-subtle transition-opacity', typers.length ? 'opacity-100' : 'opacity-0')} aria-live="polite">
              {typers.length ? `${typers.map((t) => displayName(profiles[t])).join(', ')} ${typers.length > 1 ? 'are' : 'is'} typing…` : '.'}
            </span>
            <Button size="sm" variant="primary" icon={<Send className="size-3" />} loading={sending} disabled={!body.trim()} onClick={send}>
              Comment <span className="ml-1 opacity-60">{modKey}↵</span>
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-fg-subtle">Your role can’t comment here.</p>
      )}
    </div>
  );
}
