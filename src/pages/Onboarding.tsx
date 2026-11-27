import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Link2, LogOut, Mail, X } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';
import { AuthLayout } from './Auth';
import { teamColor, TeamMark } from '@/components/layout/Sidebar';
import { useWorkspace } from '@/store/workspace';
import { useSession } from '@/store/session';
import { acceptInvite, declineInvite } from '@/lib/actions';
import { cn } from '@/lib/format';

const COLORS = ['green', 'indigo', 'blue', 'violet', 'amber', 'rose'];

export function parseInviteToken(input: string): string | null {
  const s = input.trim();
  const m = s.match(/corel:\/\/(?:join|invite)\/([A-Za-z0-9]+)/) || s.match(/^([A-Fa-f0-9]{32,64})$/);
  return m?.[1] ?? null;
}

export function JoinWithInvite({ onJoined }: { onJoined?: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const token = parseInviteToken(value);
  return (
    <div className="flex gap-2">
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="corel://join/…" icon={<Link2 />} className="font-mono text-[12px]" />
      <Button
        loading={busy}
        disabled={!token}
        onClick={async () => {
          setBusy(true);
          try {
            await acceptInvite(token!);
            toast.success('You joined the team');
            onJoined?.();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Join
      </Button>
    </div>
  );
}

export function PendingInvites() {
  const invites = useWorkspace((s) => s.myInvites);
  const [busy, setBusy] = useState<string | null>(null);
  if (!invites.length) return null;
  return (
    <ul className="space-y-2">
      {invites.map((i) => (
        <li key={i.id} className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent-soft/40 p-3">
          <Mail className="size-4 text-accent-text" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{i.team_name ?? 'A team'}</p>
            <p className="text-[12px] capitalize text-fg-muted">Join as {i.role}</p>
          </div>
          <Button size="sm" variant="ghost" aria-label="Decline" disabled={!!busy} onClick={async () => { setBusy(i.id); try { await declineInvite(i.id); } catch (e) { toast.error(String((e as Error).message)); } setBusy(null); }}>
            <X className="size-3.5" />
          </Button>
          <Button size="sm" variant="primary" loading={busy === i.id} icon={<Check className="size-3.5" />} onClick={async () => { setBusy(i.id); try { await acceptInvite(i.token); toast.success(`Joined ${i.team_name}`); } catch (e) { toast.error(String((e as Error).message)); } setBusy(null); }}>
            Accept
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function CreateTeamForm({ onCreated }: { onCreated?: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('green');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      await useWorkspace.getState().createTeam(name.trim(), color);
      onCreated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <Field label="Team name">
        <div className="flex items-center gap-2">
          <TeamMark name={name || 'T'} color={color} size={32} />
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Blocky Studios" autoFocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()} />
        </div>
      </Field>
      <Field label="Colour">
        <div className="flex gap-2" role="radiogroup" aria-label="Team colour">
          {COLORS.map((c) => (
            <button key={c} role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} className={cn('size-7 rounded-md ring-offset-2 ring-offset-panel transition', color === c && 'ring-2 ring-fg')} style={{ background: teamColor(c) }} />
          ))}
        </div>
      </Field>
      <Button variant="primary" className="w-full" loading={busy} disabled={!name.trim()} onClick={create}>Create team</Button>
    </div>
  );
}

export function Onboarding() {
  const profile = useSession((s) => s.profile);
  const invites = useWorkspace((s) => s.myInvites);
  return (
    <AuthLayout footer={<button className="inline-flex items-center gap-1.5 hover:text-fg" onClick={() => useSession.getState().signOut()}><LogOut className="size-3" /> Sign out</button>}>
      <h1 className="text-center text-[19px] font-semibold tracking-[-0.02em]">Welcome{profile?.display_name ? `, ${profile.display_name}` : ''}</h1>
      <p className="mt-1 text-center text-[13px] text-fg-muted">Create a team for your studio, or join one you were invited to.</p>
      {invites.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-[12px] font-medium text-fg-muted">Invitations for you</h2>
          <PendingInvites />
        </div>
      )}
      <div className="mt-6 rounded-xl border border-line bg-panel p-5">
        <CreateTeamForm />
      </div>
      <div className="mt-4 rounded-xl border border-line bg-panel p-5">
        <Field label="Have an invite link?"><JoinWithInvite /></Field>
      </div>
    </AuthLayout>
  );
}
