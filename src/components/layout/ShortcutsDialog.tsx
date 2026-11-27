import { Dialog, Kbd } from '@/components/ui';
import { useUI } from '@/store/ui';
import { modKey } from '@/lib/format';

export const SHORTCUTS: { group: string; items: [string, string[]][] }[] = [
  {
    group: 'General',
    items: [
      ['Search and commands', [modKey, 'K']],
      ['Toggle sidebar', [modKey, 'B']],
      ['Open settings', [modKey, ',']],
      ['Notifications', ['N']],
      ['Keyboard shortcuts', ['?']],
      ['Interface size', [modKey, '+ / − / 0']],
    ],
  },
  {
    group: 'Navigation',
    items: [
      ['Overview', ['G', 'O']],
      ['Projects', ['G', 'P']],
      ['Publish', ['G', 'U']],
      ['Analytics', ['G', 'A']],
      ['Bugs', ['G', 'B']],
      ['Scripts', ['G', 'S']],
      ['Team', ['G', 'T']],
    ],
  },
  {
    group: 'Create & edit',
    items: [
      ['Create (bug, project, script or task for the current page)', ['C']],
      ['Save script', [modKey, 'S']],
      ['Format script', ['Shift', 'Alt', 'F']],
      ['Send comment', [modKey, 'Enter']],
    ],
  },
];

export function ShortcutsDialog() {
  const open = useUI((s) => s.shortcuts);
  const set = useUI((s) => s.set);
  return (
    <Dialog open={open} onOpenChange={(o) => set({ shortcuts: o })} title="Keyboard shortcuts" width={560}>
      <ShortcutList />
    </Dialog>
  );
}

export function ShortcutList() {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {SHORTCUTS.map((g) => (
        <div key={g.group} className={g.group === 'Create & edit' ? 'sm:col-span-2' : ''}>
          <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">{g.group}</h4>
          <ul className="space-y-1">
            {g.items.map(([label, keys]) => (
              <li key={label} className="flex items-center justify-between gap-3 py-0.5 text-[13px]">
                <span className="text-fg-muted">{label}</span>
                <span className="flex shrink-0 gap-1">
                  {keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
