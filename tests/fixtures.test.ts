import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { generateYaml } from '../src/lib/generate';
import { SCENARIOS } from './scenarios';

// fixtures/valid/*.yaml are generated from tests/scenarios.ts and committed so CI can run
// the real `netplan generate --root-dir` against them. Regenerate with
//   UPDATE_FIXTURES=1 npx vitest run tests/fixtures.test.ts
const VALID = 'fixtures/valid';
const INVALID = 'fixtures/invalid';
const update = process.env.UPDATE_FIXTURES === '1';

describe('committed netplan fixtures', () => {
  if (update) mkdirSync(VALID, { recursive: true });
  for (const s of SCENARIOS) {
    it(`${s.name}.yaml matches the generator output`, () => {
      const path = join(VALID, `${s.name}.yaml`);
      const yaml = generateYaml(s.build());
      if (update) writeFileSync(path, yaml);
      expect(existsSync(path), `${path} missing; run with UPDATE_FIXTURES=1`).toBe(true);
      expect(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).toBe(yaml);
    });
  }
  it('has no stale valid fixtures', () => {
    const names = new Set(SCENARIOS.map((s) => `${s.name}.yaml`));
    expect(readdirSync(VALID).filter((f) => f.endsWith('.yaml') && !names.has(f))).toEqual([]);
  });
  it('every fixture (valid and invalid) is well-formed YAML with unique keys', () => {
    for (const dir of [VALID, INVALID]) {
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.yaml'))) {
        const doc = parseDocument(readFileSync(join(dir, f), 'utf8'), { uniqueKeys: true, strict: true });
        expect(doc.errors, `${dir}/${f}`).toEqual([]);
        expect(doc.toJS().network.version, `${dir}/${f}`).toBe(2);
      }
    }
  });
});
