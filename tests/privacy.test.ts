import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const SRC = files('src').filter((f) => /\.(ts|css)$/.test(f));
const read = (f: string) => readFileSync(f, 'utf8');

describe('privacy: no persistence, telemetry or network access in source', () => {
  const forbidden: [string, RegExp][] = [
    ['localStorage', /localStorage/],
    ['sessionStorage', /sessionStorage/],
    ['indexedDB', /indexedDB/],
    ['cookies', /document\.cookie/],
    ['fetch', /\bfetch\s*\(/],
    ['XMLHttpRequest', /XMLHttpRequest/],
    ['WebSocket', /WebSocket/],
    ['EventSource', /EventSource/],
    ['sendBeacon', /sendBeacon/],
    ['console logging', /console\.(log|info|warn|error|debug)/],
    ['innerHTML', /innerHTML|outerHTML|insertAdjacentHTML/],
    ['eval', /\beval\s*\(|new Function\s*\(/],
    ['history/URL state', /history\.(push|replace)State|location\.(hash|search)\s*=/],
    ['service worker', /serviceWorker/],
    ['CSS imports from network', /@import\s+url\(\s*['"]?https?:/],
  ];
  for (const f of SRC) {
    it(`${f} avoids forbidden APIs`, () => {
      const text = read(f);
      for (const [name, re] of forbidden) expect(re.test(text), `${name} in ${f}`).toBe(false);
    });
  }
  it('index.html loads no external scripts, styles or fonts', () => {
    const html = read('index.html');
    expect(html).not.toMatch(/<script[^>]+src=["']https?:/i);
    expect(html).not.toMatch(/<link[^>]+href=["']https?:/i);
  });
  it('production CSP forbids network connections', () => {
    const vite = read('vite.config.ts');
    expect(vite).toContain("connect-src 'none'");
    expect(vite).toContain("script-src 'self'");
  });
  it('package has no runtime dependencies', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
