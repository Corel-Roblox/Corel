import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ConfirmHost, TooltipProvider } from '@/components/ui';
import { TitleBar } from '@/components/layout/TitleBar';
import { Shell } from '@/components/layout/Shell';
import { applyPrefs, usePrefs } from '@/store/prefs';
import { useSession } from '@/store/session';
import { useWorkspace } from '@/store/workspace';
import { useEngine } from '@/store/engine';
import { usePresence } from '@/store/presence';
import { useNotifications } from '@/store/notifications';
import { useUI } from '@/store/ui';
import { invoke, isDesktop, listen } from '@/lib/tauri';
import { startBackgroundJobs, stopBackgroundJobs } from '@/lib/background';
import { AuthPage } from '@/pages/Auth';
import { BackendSetup } from '@/pages/BackendSetup';
import { Onboarding } from '@/pages/Onboarding';
import { OverviewPage } from '@/pages/Overview';
import { ProjectsPage } from '@/pages/Projects';
import { ProjectWorkspace } from '@/pages/ProjectWorkspace';
import { PublishPage } from '@/pages/Publish';
import { AnalyticsPage } from '@/pages/Analytics';
import { BugsPage } from '@/pages/Bugs';
import { ScriptsPage } from '@/pages/Scripts';
import { TeamPage } from '@/pages/Team';
import { SettingsPage } from '@/pages/Settings';
import { InviteLanding } from '@/pages/InviteLanding';
import { RequiresAccount } from '@/pages/RequiresAccount';

export function App() {
  const prefs = usePrefs();
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const offline = useUI((s) => s.offline);
  const teamsLoaded = useWorkspace((s) => s.teamsLoaded);
  const teams = useWorkspace((s) => s.teams);
  const teamId = useWorkspace((s) => s.teamId);
  const pendingLink = useUI((s) => s.pendingLink);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => applyPrefs(prefs), [prefs.theme, prefs.accent, prefs.reduceMotion, prefs.scale]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (prefs.theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: light)');
    const f = () => applyPrefs(usePrefs.getState());
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [prefs.theme]);

  useEffect(() => {
    useSession.getState().init();
    useEngine.getState().start();
    if (!isDesktop) return;
    invoke<string | null>('take_pending_link').then((l) => l && useUI.getState().set({ pendingLink: l }));
    const un = listen<string>('open-link', (l) => useUI.getState().set({ pendingLink: l }));
    return () => {
      un.then((f) => f());
    };
  }, []);

  // Signed in: load teams, notifications.
  useEffect(() => {
    if (status === 'signed-in' && user) {
      useWorkspace.getState().loadTeams().catch(() => {});
      useNotifications.getState().start(user.id);
    } else if (status === 'signed-out') {
      useWorkspace.getState().reset();
      useNotifications.getState().stop();
      usePresence.getState().stop();
    }
  }, [status, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Presence + background jobs per team.
  useEffect(() => {
    if (teamId && user) {
      usePresence.getState().start(teamId, user.id);
      startBackgroundJobs();
    }
    return () => stopBackgroundJobs();
  }, [teamId, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = location.pathname.match(/^\/projects\/([0-9a-f-]{36})/);
    usePresence.getState().update({ route: location.pathname, project_id: m?.[1] ?? null });
  }, [location.pathname]);

  // Invite links (corel://join/<token>) open the invite page.
  useEffect(() => {
    if (!pendingLink || status !== 'signed-in') return;
    const token = pendingLink.match(/corel:\/\/(?:join|invite)\/([A-Za-z0-9]+)/)?.[1];
    useUI.getState().set({ pendingLink: null });
    if (token) navigate(`/invite/${token}`);
  }, [pendingLink, status, navigate]);

  let body: React.ReactNode;
  if (status === 'loading') body = <div className="flex-1" />;
  else if (offline)
    body = (
      <Shell offline>
        <Routes>
          <Route path="/publish/*" element={<PublishPage />} />
          <Route path="/settings/:section?" element={<SettingsPage />} />
          <Route path="*" element={<RequiresAccount />} />
        </Routes>
      </Shell>
    );
  else if (status === 'no-backend') body = <BackendSetup />;
  else if (status === 'signed-out') body = <AuthPage />;
  else if (!teamsLoaded) body = <div className="flex-1" />;
  else if (location.pathname.startsWith('/invite/'))
    body = (
      <Routes>
        <Route path="/invite/:token" element={<InviteLanding />} />
      </Routes>
    );
  else if (!teams.length) body = <Onboarding />;
  else
    body = (
      <Shell>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id/:tab?" element={<ProjectWorkspace />} />
          <Route path="/publish/:expId?" element={<PublishPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/bugs/:bugId?" element={<BugsPage />} />
          <Route path="/scripts/:scriptId?" element={<ScriptsPage />} />
          <Route path="/team/:tab?" element={<TeamPage />} />
          <Route path="/settings/:section?" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    );

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-bg text-fg">
        <TitleBar />
        <div className="flex min-h-0 flex-1">{body}</div>
      </div>
      <ConfirmHost />
      <Toaster
        position="bottom-right"
        theme={document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'}
        toastOptions={{ classNames: { toast: '!bg-overlay !border-line-strong !text-fg !rounded-lg !shadow-pop', description: '!text-fg-muted' } }}
      />
    </TooltipProvider>
  );
}
