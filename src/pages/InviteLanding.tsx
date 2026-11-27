import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Notice, Spinner } from '@/components/ui';
import { AuthLayout } from './Auth';
import { TeamMark } from '@/components/layout/Sidebar';
import { sb } from '@/lib/supabase';
import { acceptInvite } from '@/lib/actions';
import { useSession } from '@/store/session';
import { useWorkspace } from '@/store/workspace';

interface InvitePreview {
  id: string;
  team_id: string;
  team_name: string;
  team_color: string;
  team_avatar?: string | null;
  role: string;
  email: string | null;
  status: string;
  expired: boolean;
  invited_by: string;
  already_member: boolean;
}

export function InviteLanding() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const email = useSession((s) => s.user?.email);
  const [invite, setInvite] = useState<InvitePreview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    sb().rpc('get_invite', { p_token: token }).then(({ data }) => setInvite((data as InvitePreview) ?? null));
  }, [token]);

  const accept = async () => {
    setBusy(true);
    try {
      await acceptInvite(token);
      toast.success(`Welcome to ${invite?.team_name}`);
      navigate('/');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const leave = () => navigate(useWorkspace.getState().teams.length ? '/' : '/');

  let problem: string | null = null;
  if (invite === null) problem = 'This invite link is not valid. Ask your teammate for a new one.';
  else if (invite?.already_member) problem = `You are already a member of ${invite.team_name}.`;
  else if (invite?.expired) problem = 'This invite has expired. Ask for a new one.';
  else if (invite && invite.status !== 'pending') problem = `This invite was ${invite.status}.`;
  else if (invite?.email && email && invite.email.toLowerCase() !== email.toLowerCase()) problem = `This invite was sent to ${invite.email}. You are signed in as ${email}.`;

  return (
    <AuthLayout>
      {invite === undefined ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <div className="rounded-xl border border-line bg-panel p-6 text-center">
          {invite && <div className="mb-4 flex justify-center"><TeamMark name={invite.team_name} color={invite.team_color} url={invite.team_avatar} size={44} /></div>}
          <h1 className="text-[18px] font-semibold tracking-[-0.02em]">{invite ? `Join ${invite.team_name}` : 'Invite not found'}</h1>
          {invite && <p className="mt-1 text-[13px] text-fg-muted">{invite.invited_by} invited you as <span className="capitalize text-fg">{invite.role}</span>.</p>}
          <div className="mt-5 space-y-3 text-left">
            {problem && <Notice tone="warning">{problem}</Notice>}
            <div className="flex gap-2">
              <Button className="flex-1" variant="ghost" onClick={leave}>{problem ? 'Back' : 'Not now'}</Button>
              {!problem && <Button className="flex-1" variant="primary" loading={busy} onClick={accept}>Accept invite</Button>}
            </div>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
