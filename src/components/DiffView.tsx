import { useMemo } from 'react';
import { diffLines } from 'diff';
import { cn } from '@/lib/format';

/** Line diff between two versions of a script (old → new). */
export function DiffView({ before, after, className }: { before: string; after: string; className?: string }) {
  const parts = useMemo(() => diffLines(before, after), [before, after]);
  let a = 0;
  let b = 0;
  const rows: { kind: 'add' | 'del' | 'same'; text: string; na?: number; nb?: number }[] = [];
  for (const p of parts) {
    const lines = p.value.replace(/\n$/, '').split('\n');
    for (const line of lines) {
      if (p.added) rows.push({ kind: 'add', text: line, nb: ++b });
      else if (p.removed) rows.push({ kind: 'del', text: line, na: ++a });
      else rows.push({ kind: 'same', text: line, na: ++a, nb: ++b });
    }
  }
  const changed = rows.filter((r) => r.kind !== 'same').length;
  return (
    <div className={cn('overflow-auto rounded-lg border border-line bg-sunken font-mono text-[12px] leading-[1.6]', className)}>
      {changed === 0 && <p className="px-3 py-2 font-sans text-[12.5px] text-fg-subtle">No differences.</p>}
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={cn(r.kind === 'add' && 'bg-success-soft', r.kind === 'del' && 'bg-danger-soft')}>
              <td className="w-10 select-none px-2 text-right text-fg-subtle">{r.na ?? ''}</td>
              <td className="w-10 select-none px-2 text-right text-fg-subtle">{r.nb ?? ''}</td>
              <td className={cn('w-4 select-none text-center', r.kind === 'add' ? 'text-success' : r.kind === 'del' ? 'text-danger' : 'text-fg-subtle')}>{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ''}</td>
              <td className="selectable whitespace-pre pr-3">{r.text || ' '}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
