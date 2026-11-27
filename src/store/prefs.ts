import { createWithEqualityFn as create } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light' | 'system';
export type Accent = 'green' | 'indigo' | 'blue' | 'violet' | 'amber' | 'rose';

export const ACCENTS: { id: Accent; label: string; swatch: string }[] = [
  { id: 'green', label: 'Signal green', swatch: '#22c55e' },
  { id: 'indigo', label: 'Indigo', swatch: '#818cf8' },
  { id: 'blue', label: 'Blue', swatch: '#3b9eff' },
  { id: 'violet', label: 'Violet', swatch: '#a78bfa' },
  { id: 'amber', label: 'Amber', swatch: '#f5b83d' },
  { id: 'rose', label: 'Rose', swatch: '#fb7185' },
];

export const WIDGETS = [
  { id: 'stats', label: 'Workspace numbers' },
  { id: 'upcoming', label: 'Upcoming updates' },
  { id: 'activity', label: 'Recent activity' },
  { id: 'bugs', label: 'Recent bug reports' },
  { id: 'performance', label: 'Game performance' },
  { id: 'scripts', label: 'Recently edited scripts' },
  { id: 'tasks', label: 'My tasks' },
  { id: 'projects', label: 'Project summaries' },
] as const;
export type WidgetId = (typeof WIDGETS)[number]['id'];

interface Prefs {
  theme: Theme;
  accent: Accent;
  scale: number;
  reduceMotion: boolean;
  sidebarCollapsed: boolean;
  lastTeamId: string | null;
  widgetOrder: WidgetId[];
  hiddenWidgets: WidgetId[];
  desktopNotifications: boolean;
  publishReminders: boolean;
  set: (p: Partial<Omit<Prefs, 'set'>>) => void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      theme: 'dark',
      accent: 'green',
      scale: 1,
      reduceMotion: false,
      sidebarCollapsed: false,
      lastTeamId: null,
      widgetOrder: WIDGETS.map((w) => w.id),
      hiddenWidgets: [],
      desktopNotifications: true,
      publishReminders: true,
      set: (p) => set(p),
    }),
    { name: 'corel.prefs', version: 1 },
  ),
  shallow,
);

/** Applies theme, accent, motion and scale to the document. */
export function applyPrefs(p: Pick<Prefs, 'theme' | 'accent' | 'reduceMotion' | 'scale'>) {
  const root = document.documentElement;
  const theme = p.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : p.theme;
  root.dataset.theme = theme;
  root.dataset.accent = p.accent;
  root.dataset.motion = p.reduceMotion ? 'reduced' : 'full';
  root.style.setProperty('zoom', String(p.scale));
}
