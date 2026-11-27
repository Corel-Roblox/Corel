import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './styles.css';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);

// Fade out the boot splash once the first frame has rendered.
requestAnimationFrame(() => {
  const s = document.getElementById('splash');
  if (!s) return;
  window.setTimeout(() => {
    s.classList.add('out');
    window.setTimeout(() => s.remove(), 300);
  }, 180);
});

// Development only: expose stores for debugging in the browser console.
if (import.meta.env.DEV) {
  Promise.all([import('./store/session'), import('./store/workspace'), import('./store/ui'), import('./store/presence')]).then(([s, w, u, p]) => {
    (window as unknown as Record<string, unknown>).__corel = { session: s.useSession, workspace: w.useWorkspace, ui: u.useUI, presence: p.usePresence };
  });
}
