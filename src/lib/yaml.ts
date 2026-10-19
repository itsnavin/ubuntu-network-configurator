// Minimal, deliberately conservative YAML emitter.
// * Every user-provided string (keys and values) is emitted as a double-quoted scalar with
//   full escaping, so input can never inject YAML structure, comments, anchors or tags, and
//   values such as "no", "on", "0123", "11:22:33" (YAML 1.1 sexagesimal) or IPv6 text keep
//   their exact string form.
// * Only fixed, internal keys are emitted plain.
// * Integers and booleans are emitted plain.

export type YNode =
  | { t: 'map'; entries: YEntry[] }
  | { t: 'seq'; items: YNode[] }
  | { t: 'str'; v: string }
  | { t: 'int'; v: number }
  | { t: 'bool'; v: boolean };

export interface YEntry {
  key: string;
  /** True when the key comes from user input and must be quoted. */
  userKey: boolean;
  value: YNode;
}

export const ystr = (v: string): YNode => ({ t: 'str', v });
export const yint = (v: number): YNode => {
  if (!Number.isSafeInteger(v)) throw new Error(`Not a safe integer: ${v}`);
  return { t: 'int', v };
};
export const ybool = (v: boolean): YNode => ({ t: 'bool', v });
export const yseq = (items: YNode[]): YNode => ({ t: 'seq', items });
export const ymap = (entries: YEntry[]): YNode => ({ t: 'map', entries });
export const fixed = (key: string, value: YNode): YEntry => {
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(key)) throw new Error(`Invalid fixed key: ${key}`);
  return { key, userKey: false, value };
};
export const userKey = (key: string, value: YNode): YEntry => ({ key, userKey: true, value });

/** Escapes a string as a YAML 1.1/1.2 double-quoted scalar. */
export function quote(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (cp === 0x0a) out += '\\n';
    else if (cp === 0x09) out += '\\t';
    else if (cp === 0x0d) out += '\\r';
    else if (cp < 0x20 || cp === 0x7f) out += '\\x' + cp.toString(16).padStart(2, '0');
    else if (cp >= 0x80 && cp <= 0x9f) out += '\\x' + cp.toString(16).padStart(2, '0');
    else if (cp === 0x2028 || cp === 0x2029 || cp === 0xfeff) out += '\\u' + cp.toString(16).padStart(4, '0');
    else if (cp >= 0xd800 && cp <= 0xdfff) throw new Error('Lone UTF-16 surrogate cannot be encoded');
    else out += ch;
  }
  return out + '"';
}

function scalar(n: YNode): string | null {
  switch (n.t) {
    case 'str':
      return quote(n.v);
    case 'int':
      return String(n.v);
    case 'bool':
      return n.v ? 'true' : 'false';
    case 'seq':
      return n.items.length === 0 ? '[]' : null;
    case 'map':
      return n.entries.length === 0 ? '{}' : null;
  }
}

function emitKey(e: YEntry): string {
  return e.userKey ? quote(e.key) : e.key;
}

function emitNode(n: YNode, indent: number, lines: string[]): void {
  const pad = '  '.repeat(indent);
  if (n.t === 'map') {
    for (const e of n.entries) {
      const s = scalar(e.value);
      if (s !== null) lines.push(`${pad}${emitKey(e)}: ${s}`);
      else {
        lines.push(`${pad}${emitKey(e)}:`);
        emitNode(e.value, indent + 1, lines);
      }
    }
  } else if (n.t === 'seq') {
    for (const item of n.items) {
      const s = scalar(item);
      if (s !== null) lines.push(`${pad}- ${s}`);
      else {
        const sub: string[] = [];
        emitNode(item, indent + 1, sub);
        // Put the first line of the nested block on the dash line.
        const first = sub[0].slice(('  '.repeat(indent + 1)).length);
        lines.push(`${pad}- ${first}`);
        lines.push(...sub.slice(1));
      }
    }
  } else {
    throw new Error('Top-level node must be a collection');
  }
}

export function emitYaml(root: YNode, headerComments: string[] = []): string {
  const lines: string[] = [];
  for (const c of headerComments) {
    if (/[\r\n\u0085\u2028\u2029]/.test(c)) throw new Error('Comment lines must not contain line breaks');
    lines.push(c === '' ? '#' : `# ${c}`);
  }
  emitNode(root, 0, lines);
  return lines.join('\n') + '\n';
}
