import { useEffect, useRef } from 'react';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars, rectangularSelection, crosshairCursor, dropCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { luauCompletions, luauHighlight, luauLanguage } from '@/lib/luau';

export interface CodeEditorHandle {
  view: EditorView | null;
}

/**
 * Luau editor. Controlled loosely: `value` replaces the document only when it differs
 * from what the editor holds (e.g. a teammate's saved version was applied), keeping the
 * cursor in place as far as possible.
 */
export function CodeEditor({ value, onChange, readOnly, onSave, onFormat, onCursor, handle }: { value: string; onChange: (v: string) => void; readOnly?: boolean; onSave?: () => void; onFormat?: () => void; onCursor?: (line: number) => void; handle?: React.MutableRefObject<CodeEditorHandle> }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const ro = useRef(new Compartment());
  const cbs = useRef({ onChange, onSave, onFormat, onCursor });
  cbs.current = { onChange, onSave, onFormat, onCursor };

  useEffect(() => {
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      indentUnit.of('\t'),
      EditorState.tabSize.of(4),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ override: [luauCompletions] }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      luauLanguage,
      luauHighlight,
      keymap.of([
        { key: 'Mod-s', preventDefault: true, run: () => (cbs.current.onSave?.(), true) },
        { key: 'Shift-Alt-f', preventDefault: true, run: () => (cbs.current.onFormat?.(), true) },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      ro.current.of(EditorState.readOnly.of(!!readOnly)),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) cbs.current.onChange(u.state.doc.toString());
        if (u.selectionSet || u.docChanged) cbs.current.onCursor?.(u.state.doc.lineAt(u.state.selection.main.head).number);
      }),
      EditorView.contentAttributes.of({ 'aria-label': 'Luau code editor', spellcheck: 'false' }),
    ];
    view.current = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: host.current! });
    if (handle) handle.current.view = view.current;
    return () => {
      view.current?.destroy();
      view.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur === value) return;
    const head = Math.min(v.state.selection.main.head, value.length);
    v.dispatch({ changes: { from: 0, to: cur.length, insert: value }, selection: { anchor: head } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure(EditorState.readOnly.of(!!readOnly)) });
  }, [readOnly]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
