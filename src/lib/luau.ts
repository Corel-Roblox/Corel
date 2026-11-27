// Luau support for CodeMirror: tokenizer (Lua 5.1 + Luau types, compound assignment,
// string interpolation, `continue`), block-based indentation, completions for common
// Roblox globals, and a re-indenting formatter.
import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';

const keywords = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'for', 'function', 'if', 'in', 'local', 'not', 'or', 'repeat', 'return', 'then', 'until', 'while', 'continue', 'export', 'type', 'typeof']);
const atoms = new Set(['true', 'false', 'nil', 'self']);
const builtins = new Set([
  'game', 'workspace', 'script', 'plugin', 'shared', 'Enum', 'Instance', 'Vector3', 'Vector2', 'CFrame', 'Color3', 'UDim', 'UDim2', 'BrickColor', 'Ray', 'Region3', 'TweenInfo', 'NumberRange', 'NumberSequence', 'ColorSequence', 'Rect', 'Random', 'DateTime', 'RaycastParams', 'OverlapParams',
  'task', 'math', 'string', 'table', 'coroutine', 'os', 'debug', 'utf8', 'bit32', 'buffer',
  'print', 'warn', 'error', 'assert', 'pcall', 'xpcall', 'require', 'select', 'type', 'typeof', 'tostring', 'tonumber', 'pairs', 'ipairs', 'next', 'rawget', 'rawset', 'rawequal', 'rawlen', 'setmetatable', 'getmetatable', 'unpack', 'tick', 'time', 'wait', 'delay', 'spawn', 'newproxy', 'gcinfo',
]);
const typeNames = new Set(['number', 'string', 'boolean', 'any', 'unknown', 'never', 'thread', 'userdata', 'vector']);


interface State {
  inString: false | '"' | "'" | '`';
  longLevel: number; // >= 0 inside [[ ]] / [=[ ]=] strings
  longComment: boolean;
  depth: number; // raw block depth (keywords + brackets)
  lineStart: number; // depth at the start of the current line
  visual: number; // indentation level of the current line
  lastWasLocal: boolean;
}

function readLong(stream: Parameters<StreamParser<State>['token']>[0], level: number): boolean {
  const close = ']' + '='.repeat(level) + ']';
  while (!stream.eol()) {
    if (stream.match(close)) return true;
    stream.next();
  }
  return false;
}

const parser: StreamParser<State> = {
  name: 'luau',
  startState: () => ({ inString: false, longLevel: -1, longComment: false, depth: 0, lineStart: 0, visual: 0, lastWasLocal: false }),
  token(stream, state) {
    if (stream.sol()) {
      // Finalize the previous line's indentation level.
      state.visual = Math.max(0, state.visual + Math.max(-1, Math.min(1, state.depth - state.lineStart)));
      state.lineStart = state.depth;
    }
    if (state.longLevel >= 0) {
      const isComment = state.longComment;
      if (readLong(stream, state.longLevel)) state.longLevel = -1;
      return isComment ? 'comment' : 'string';
    }
    if (state.inString) {
      const q = state.inString;
      let escaped = false;
      while (!stream.eol()) {
        const ch = stream.next();
        if (!escaped && ch === q) {
          state.inString = false;
          break;
        }
        escaped = !escaped && ch === '\\';
      }
      if (stream.eol() && state.inString && q !== '`' && !escaped) state.inString = false;
      return 'string';
    }
    if (stream.eatSpace()) return null;

    if (stream.match('--')) {
      const m = stream.match(/^\[(=*)\[/);
      if (m) {
        state.longLevel = (m as RegExpMatchArray)[1].length;
        state.longComment = true;
        if (readLong(stream, state.longLevel)) state.longLevel = -1;
        return 'comment';
      }
      stream.skipToEnd();
      return 'comment';
    }
    const long = stream.match(/^\[(=*)\[/);
    if (long) {
      state.longLevel = (long as RegExpMatchArray)[1].length;
      state.longComment = false;
      if (readLong(stream, state.longLevel)) state.longLevel = -1;
      return 'string';
    }
    const ch = stream.peek()!;
    if (ch === '"' || ch === "'" || ch === '`') {
      stream.next();
      state.inString = ch;
      return parser.token(stream, state);
    }
    if (stream.match(/^0x[0-9a-fA-F_]+/) || stream.match(/^0b[01_]+/) || stream.match(/^\d[\d_]*(\.[\d_]*)?([eE][+-]?\d+)?/) || stream.match(/^\.\d+/)) return 'number';
    if (stream.match(/^[A-Za-z_][\w]*/)) {
      const w = stream.current();
      const wasLocal = state.lastWasLocal;
      state.lastWasLocal = w === 'local';
      if (keywords.has(w)) {
        if (w === 'function' || w === 'then' || w === 'do' || w === 'repeat') state.depth++;
        else if (w === 'end' || w === 'until' || w === 'elseif') state.depth--;
        return 'keyword';
      }
      if (atoms.has(w)) return 'atom';
      if (builtins.has(w)) return 'builtin';
      if (typeNames.has(w)) return 'typeName';
      if (stream.match(/^\s*\(/, false)) return 'function';
      if (/^[A-Z]/.test(w)) return 'className';
      return wasLocal ? 'definition' : 'variable';
    }
    if (stream.match(/^(\+=|-=|\*=|\/=|\/\/=|%=|\^=|\.\.=|==|~=|<=|>=|->|\.\.\.?|::|\/\/)/)) return 'operator';
    stream.next();
    if (ch === '{' || ch === '(') state.depth++;
    else if (ch === '}' || ch === ')') state.depth--;
    return /[+\-*/%^#<>=:]/.test(ch) ? 'operator' : /[{}()[\],;.]/.test(ch) ? 'punctuation' : null;
  },
  indent(state, textAfter, cx) {
    if (state.inString || state.longLevel >= 0) return null;
    // One level per line at most: `task.spawn(function()` opens one level, `end)` closes one.
    const level = state.visual + Math.max(-1, Math.min(1, state.depth - state.lineStart));
    const closes = /^\s*(end|else|elseif|until|\}|\))/.test(textAfter) ? 1 : 0;
    return Math.max(0, level - closes) * cx.unit;
  },
  languageData: {
    commentTokens: { line: '--', block: { open: '--[[', close: ']]' } },
    indentOnInput: /^\s*(end|else|elseif|until|\}|\))$/,
    closeBrackets: { brackets: ['(', '[', '{', '"', "'", '`'] },
  },
  tokenTable: {
    builtin: t.standard(t.variableName),
    typeName: t.typeName,
    className: t.className,
    definition: t.definition(t.variableName),
    function: t.function(t.variableName),
    atom: t.atom,
    punctuation: t.punctuation,
  },
};

export const luauLanguage = StreamLanguage.define(parser);

export const luauHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.keyword, color: 'var(--syn-keyword, #c792ea)' },
    { tag: [t.atom, t.bool], color: 'var(--syn-atom, #f78c6c)' },
    { tag: t.number, color: 'var(--syn-number, #f78c6c)' },
    { tag: t.string, color: 'var(--syn-string, #a5d6a7)' },
    { tag: t.comment, color: 'var(--syn-comment, #6b7385)', fontStyle: 'italic' },
    { tag: t.standard(t.variableName), color: 'var(--syn-builtin, #82aaff)' },
    { tag: t.function(t.variableName), color: 'var(--syn-fn, #7fdbca)' },
    { tag: [t.typeName, t.className], color: 'var(--syn-type, #ffcb6b)' },
    { tag: t.definition(t.variableName), color: 'var(--fg)' },
    { tag: t.operator, color: 'var(--syn-op, #89ddff)' },
    { tag: t.punctuation, color: 'var(--fg-muted)' },
  ]),
);

const completionWords = [...keywords, ...atoms, ...builtins, ...typeNames,
  'GetService', 'FindFirstChild', 'WaitForChild', 'FindFirstChildOfClass', 'GetChildren', 'GetDescendants', 'Connect', 'Once', 'Wait', 'Destroy', 'Clone', 'IsA', 'SetAttribute', 'GetAttribute',
  'Players', 'ReplicatedStorage', 'ServerScriptService', 'ServerStorage', 'RunService', 'TweenService', 'UserInputService', 'DataStoreService', 'HttpService', 'MarketplaceService', 'CollectionService', 'Debris', 'SoundService', 'Lighting', 'StarterGui', 'TeleportService', 'MessagingService', 'MemoryStoreService', 'PhysicsService', 'ContextActionService', 'TextChatService',
  'task.wait', 'task.spawn', 'task.defer', 'task.delay', 'task.cancel', 'Instance.new', 'Vector3.new', 'CFrame.new', 'Color3.fromRGB', 'UDim2.new', 'UDim2.fromScale', 'UDim2.fromOffset', 'TweenInfo.new', 'table.insert', 'table.remove', 'table.find', 'table.clear', 'table.freeze', 'table.clone', 'string.format', 'string.split', 'math.clamp', 'math.floor', 'math.random',
];
const uniqueWords = [...new Set(completionWords)];

export function luauCompletions(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/[\w.]+/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  const docWords = new Set<string>();
  const text = ctx.state.doc.toString();
  for (const m of text.matchAll(/\b(?:local\s+(?:function\s+)?|function\s+)([A-Za-z_][\w]*)/g)) docWords.add(m[1]);
  const options = [...uniqueWords.map((label) => ({ label, type: keywords.has(label) ? 'keyword' : builtins.has(label) ? 'variable' : 'function' })), ...[...docWords].map((label) => ({ label, type: 'variable' }))];
  return { from: word.from, options, validFor: /^[\w.]*$/ };
}

/**
 * Re-indents Luau source by block structure (function/if/for/while/do/repeat/tables).
 * Strings and comments are respected; code inside them is never changed.
 */
export function formatLuau(src: string, indent = '\t'): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  let depth = 0;
  let inLong: string | null = null;
  const out: string[] = [];
  for (const raw of lines) {
    if (inLong) {
      out.push(raw);
      if (raw.includes(inLong)) inLong = null;
      continue;
    }
    const line = raw.trim();
    if (!line) {
      out.push('');
      continue;
    }
    const code = stripStrings(line);
    const longOpen = code.match(/\[(=*)\[/);
    const closesFirst = /^(end\b|else\b|elseif\b|until\b|\}|\))/.test(code);
    const lineDepth = Math.max(0, depth - (closesFirst ? 1 : 0));
    out.push(indent.repeat(lineDepth) + line);
    const opens = (code.match(/\b(function|then|do|repeat)\b/g) || []).length + (code.match(/[{(]/g) || []).length;
    const closes = (code.match(/\b(end|until)\b/g) || []).length + (code.match(/[})]/g) || []).length;
    // `elseif x then` closes the previous branch and its `then` opens the next one.
    const elseif = /^elseif\b/.test(code) ? 1 : 0;
    // One block level per line at most: `task.spawn(function()` opens one level, `end)` closes one.
    const net = Math.max(-1, Math.min(1, opens - closes - elseif));
    depth = Math.max(0, depth + net);
    if (longOpen && !code.includes(']' + longOpen[1] + ']', code.indexOf(longOpen[0]) + 2)) inLong = ']' + longOpen[1] + ']';
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function stripStrings(line: string): string {
  return line
    .replace(/--\[(=*)\[.*?\]\1\]/g, '')
    .replace(/--.*$/, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/\[(=*)\[.*?\]\1\]/g, '""');
}
