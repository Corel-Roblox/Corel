import { useNavigate } from 'react-router-dom';
import { Lock, Rocket } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';
import { useUI } from '@/store/ui';

/** Offline mode: collaboration sections need a workspace account. */
export function RequiresAccount() {
  const navigate = useNavigate();
  return (
    <div className="grid h-full place-items-center">
      <EmptyState
        icon={<Lock />}
        title="Sign in to use this section"
        body="Projects, analytics, bugs, scripts and team collaboration are stored in your shared workspace. Icon publishing works without an account."
        action={
          <>
            <Button icon={<Rocket className="size-3.5" />} onClick={() => navigate('/publish')}>Go to Publish</Button>
            <Button variant="primary" onClick={() => useUI.getState().set({ offline: false })}>Sign in</Button>
          </>
        }
      />
    </div>
  );
}
