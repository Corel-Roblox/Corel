import { useState } from 'react';
import { ArrowLeft, Mail, Lock, User, WifiOff } from 'lucide-react';
import { Button, Field, Input, Notice } from '@/components/ui';
import { Logo } from '@/components/common';
import { sb } from '@/lib/supabase';
import { useUI } from '@/store/ui';
import { useSession } from '@/store/session';
import { isDesktop } from '@/lib/tauri';

type Mode = 'signin' | 'signup' | 'reset' | 'sent' | 'newpass';

/** Centered auth layout shared by sign-in, setup and onboarding screens. */
export function AuthLayout({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-[380px] animate-pop-in">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Logo size={36} />
        </div>
        {children}
        {footer && <div className="mt-6 text-center text-[12.5px] text-fg-subtle">{footer}</div>}
      </div>
    </div>
  );
}

export function AuthPage() {
  const recovery = useSession((s) => s.recovery);
  const [mode, setMode] = useState<Mode>(recovery ? 'newpass' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') {
        const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
        const { data, error } = await sb().auth.signUp({ email: email.trim(), password, options: { data: { display_name: name.trim() } } });
        if (error) throw error;
        if (!data.session) {
          setInfo(`We sent a confirmation link to ${email.trim()}. Open it, then sign in here.`);
          setMode('sent');
        }
      } else if (mode === 'reset') {
        const { error } = await sb().auth.resetPasswordForEmail(email.trim());
        if (error) throw error;
        setInfo(`If ${email.trim()} has an account, a reset link is on its way. Open it on this PC, then set a new password.`);
        setMode('sent');
      } else if (mode === 'newpass') {
        if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
        const { error } = await sb().auth.updateUser({ password });
        if (error) throw error;
        useSession.getState().setRecovery(false);
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setError(/Invalid login/i.test(m) ? 'That email and password don’t match.' : /Failed to fetch/i.test(m) ? 'Can’t reach the workspace server. Check your connection.' : m);
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, [string, string]> = {
    signin: ['Welcome back', 'Sign in to your Corel workspace'],
    signup: ['Create your account', 'Collaborate on Roblox experiences with your team'],
    reset: ['Reset your password', 'We’ll email you a reset link'],
    sent: ['Check your email', ''],
    newpass: ['Choose a new password', ''],
  };

  return (
    <AuthLayout
      footer={
        isDesktop && (
          <button className="inline-flex items-center gap-1.5 hover:text-fg" onClick={() => useUI.getState().set({ offline: true })}>
            <WifiOff className="size-3" /> Continue without an account (icon publishing only)
          </button>
        )
      }
    >
      <h1 className="text-center text-[19px] font-semibold tracking-[-0.02em]">{titles[mode][0]}</h1>
      {titles[mode][1] && <p className="mt-1 text-center text-[13px] text-fg-muted">{titles[mode][1]}</p>}
      <div className="mt-6 rounded-xl border border-line bg-panel p-5">
        {mode === 'sent' ? (
          <div className="space-y-4">
            <Notice tone="success" icon={<Mail />}>{info}</Notice>
            <Button className="w-full" onClick={() => setMode('signin')} icon={<ArrowLeft className="size-3.5" />}>Back to sign in</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3.5">
            {mode === 'signup' && (
              <Field label="Display name" htmlFor="name">
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} icon={<User />} autoComplete="name" placeholder="Alex" required autoFocus />
              </Field>
            )}
            {mode !== 'newpass' && (
              <Field label="Email" htmlFor="email">
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} icon={<Mail />} autoComplete="email" placeholder="you@studio.dev" required autoFocus={mode !== 'signup'} />
              </Field>
            )}
            {mode !== 'reset' && (
              <Field
                label={mode === 'newpass' ? 'New password' : 'Password'}
                htmlFor="password"
                hint={mode === 'signup' || mode === 'newpass' ? 'At least 8 characters.' : undefined}
              >
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} icon={<Lock />} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required minLength={mode === 'signin' ? 1 : 8} />
              </Field>
            )}
            {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              {{ signin: 'Sign in', signup: 'Create account', reset: 'Send reset link', newpass: 'Save password', sent: '' }[mode]}
            </Button>
            {mode === 'signin' && (
              <button type="button" className="block w-full text-center text-[12.5px] text-fg-muted hover:text-fg" onClick={() => setMode('reset')}>
                Forgot your password?
              </button>
            )}
          </form>
        )}
      </div>
      {mode !== 'sent' && mode !== 'newpass' && (
        <p className="mt-4 text-center text-[12.5px] text-fg-muted">
          {mode === 'signin' ? 'New to Corel? ' : 'Already have an account? '}
          <button className="font-medium text-accent-text hover:underline" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}>
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      )}
    </AuthLayout>
  );
}
