import { describe, expect, it } from 'vitest';
import { parse, parseDocument } from 'yaml';
import { emitYaml, fixed, quote, userKey, ybool, yint, ymap, yseq, ystr } from '../src/lib/yaml';

const TRICKY = [
  'no',
  'yes',
  'off',
  'NULL',
  '~',
  '0123',
  '0x1F',
  '1e3',
  '.inf',
  '2001:db8::1',
  '::',
  'fe80::1',
  '52:54:00:12:34:56',
  '12:30:00',
  '192.168.001.010',
  '- dash',
  '? question',
  ': colon',
  'key: value',
  'hash # comment',
  '#start',
  '  leading and trailing  ',
  '"double" \'single\'',
  'back\\slash',
  'tab\there',
  'new\nline',
  'cr\rreturn',
  '{flow}',
  '[seq]',
  '&anchor',
  '*alias',
  '!tag',
  '%directive',
  '@at',
  '`tick`',
  '|literal',
  '>folded',
  'Café ☕ 🚀',
  '\u0000nul\u0007bel\u001bEsc\u007fdel',
  '\u0085nel\u00a0nbsp\u2028ls\u2029ps\ufeffbom',
  '',
  '---',
  '...',
];

describe('quote()', () => {
  it.each(TRICKY)('round-trips %j through an independent YAML parser', (s) => {
    const doc = `v: ${quote(s)}\n`;
    const parsed = parseDocument(doc, { strict: true, uniqueKeys: true });
    expect(parsed.errors).toEqual([]);
    expect(parsed.toJS().v).toBe(s);
  });
  it('always uses a double-quoted single-line scalar', () => {
    for (const s of TRICKY) {
      const q = quote(s);
      expect(q.startsWith('"') && q.endsWith('"')).toBe(true);
      expect(q).not.toMatch(/[\n\r\u2028\u2029]/);
    }
  });
  it('rejects lone surrogates instead of emitting invalid UTF-8', () => {
    expect(() => quote('a\ud800b')).toThrow();
    expect(() => quote('\udc00')).toThrow();
  });
});

describe('emitYaml()', () => {
  it('emits nested maps and sequences that parse back to the same structure', () => {
    const tree = ymap([
      fixed(
        'network',
        ymap([
          fixed('version', yint(2)),
          fixed('flag', ybool(false)),
          fixed('empty-seq', yseq([])),
          fixed('empty-map', ymap([])),
          fixed('list', yseq([ystr('a'), ystr('no'), ymap([fixed('to', ystr('default')), fixed('via', ystr('10.0.0.1'))])])),
          fixed('nested', yseq([yseq([ystr('x')])])),
          userKey('weird: key # "x"', ymap([fixed('k', ystr('v'))])),
        ]),
      ),
    ]);
    const out = emitYaml(tree, ['header']);
    expect(out.startsWith('# header\n')).toBe(true);
    expect(parse(out)).toEqual({
      network: {
        version: 2,
        flag: false,
        'empty-seq': [],
        'empty-map': {},
        list: ['a', 'no', { to: 'default', via: '10.0.0.1' }],
        nested: [['x']],
        'weird: key # "x"': { k: 'v' },
      },
    });
  });
  it('refuses unsafe fixed keys and header line breaks', () => {
    expect(() => fixed('bad key', ystr('x'))).toThrow();
    expect(() => emitYaml(ymap([]), ['a\nb'])).toThrow();
  });
  it('refuses non-integer numbers', () => {
    expect(() => yint(1.5)).toThrow();
    expect(() => yint(Number.NaN)).toThrow();
  });
  it('cannot inject structure through user strings', () => {
    const evil = 'x"\nnetwork:\n  renderer: evil\n#';
    const out = emitYaml(ymap([fixed('a', ystr(evil)), userKey(evil, ystr(evil))]));
    const js = parse(out);
    expect(Object.keys(js)).toEqual(['a', evil]);
    expect(js.a).toBe(evil);
    expect(out.split('\n').filter((l) => l.startsWith('network')).length).toBe(0);
  });
});
