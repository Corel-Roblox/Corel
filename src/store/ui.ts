import { createWithEqualityFn as create } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';

export type CreateKind = 'project' | 'bug' | 'script' | 'invite' | 'task' | null;

interface UI {
  palette: boolean;
  notifications: boolean;
  shortcuts: boolean;
  offline: boolean;
  create: CreateKind;
  createContext: { projectId?: string };
  pendingLink: string | null;
  set: (p: Partial<Omit<UI, 'set' | 'openCreate'>>) => void;
  openCreate: (kind: CreateKind, ctx?: { projectId?: string }) => void;
}

export const useUI = create<UI>()((set) => ({
  palette: false,
  notifications: false,
  shortcuts: false,
  offline: false,
  create: null,
  createContext: {},
  pendingLink: null,
  set: (p) => set(p),
  openCreate: (kind, ctx = {}) => set({ create: kind, createContext: ctx, palette: false }),
}), shallow);
