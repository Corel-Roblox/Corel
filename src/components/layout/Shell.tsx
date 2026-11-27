import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { CommandPalette } from './CommandPalette';
import { NotificationCenter } from './NotificationCenter';
import { ShortcutsDialog } from './ShortcutsDialog';
import { CreateDialogs } from '@/components/dialogs/CreateDialogs';
import { usePrefs } from '@/store/prefs';
import { useUI } from '@/store/ui';

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || !!t.closest('.cm-editor'));
}

export function Shell({ children, offline }: { children: React.ReactNode; offline?: boolean }) {
  const navigate = useNavigate();
  const goPrefix = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const ui = useUI.getState();
      if (mod && e.key.toLowerCase() === 'k' && !offline) {
        e.preventDefault();
        ui.set({ palette: !ui.palette });
        return;
      }
      if (mod && e.key.toLowerCase() === 'b' && !isTyping(e)) {
        e.preventDefault();
        usePrefs.getState().set({ sidebarCollapsed: !usePrefs.getState().sidebarCollapsed });
        return;
      }
      if (mod && e.key === ',') {
        e.preventDefault();
        navigate('/settings');
        return;
      }
      if (mod && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        e.preventDefault();
        const s = usePrefs.getState().scale;
        const next = e.key === '0' ? 1 : Math.min(1.25, Math.max(0.85, Math.round((s + (e.key === '-' ? -0.05 : 0.05)) * 100) / 100));
        usePrefs.getState().set({ scale: next });
        return;
      }
      if (isTyping(e) || mod || e.altKey || offline) return;
      if (e.key === '?') {
        ui.set({ shortcuts: true });
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'g') {
        goPrefix.current = Date.now();
        return;
      }
      if (Date.now() - goPrefix.current < 1200) {
        goPrefix.current = 0;
        const map: Record<string, string> = { o: '/', p: '/projects', u: '/publish', a: '/analytics', b: '/bugs', s: '/scripts', t: '/team', n: '/settings/notifications' };
        if (map[k]) {
          e.preventDefault();
          navigate(map[k]);
        }
        return;
      }
      if (k === 'c') {
        e.preventDefault();
        const path = location.hash.replace('#', '');
        const pid = path.match(/^\/projects\/([0-9a-f-]{36})/)?.[1];
        ui.openCreate(path.startsWith('/scripts') ? 'script' : path.startsWith('/projects/') && path.endsWith('/tasks') ? 'task' : path.startsWith('/projects') && !pid ? 'project' : 'bug', { projectId: pid });
      }
      if (k === 'n') ui.set({ notifications: !ui.notifications });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, offline]);

  return (
    <>
      <Sidebar offline={offline} />
      <main className="relative min-w-0 flex-1 overflow-hidden bg-bg">{children}</main>
      {!offline && (
        <>
          <CommandPalette />
          <NotificationCenter />
          <CreateDialogs />
        </>
      )}
      <ShortcutsDialog />
    </>
  );
}

/** Standard scrollable page container. */
export function Page({ children, wide, className }: { children: React.ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={`mx-auto px-7 pb-12 pt-6 animate-fade-in ${wide ? 'max-w-[1440px]' : 'max-w-[1180px]'} ${className ?? ''}`}>{children}</div>
    </div>
  );
}
