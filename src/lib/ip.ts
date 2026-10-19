// Strict IPv4/IPv6 parsing used for validation. No normalisation is ever written back to
// the user's input: the generator emits exactly what the user typed (trimmed) once valid.

export type Family = 4 | 6;

export interface ParsedIP {
  family: Family;
  /** Address as an unsigned big integer (32 or 128 bits). */
  value: bigint;
  text: string;
}

export interface ParsedCIDR extends ParsedIP {
  prefix: number;
}

const V4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Parses dotted-quad IPv4. Rejects leading zeros (e.g. "010") because some tools read them as octal. */
export function parseIPv4(text: string): bigint | null {
  const m = V4_RE.exec(text);
  if (!m) return null;
  let v = 0n;
  for (let i = 1; i <= 4; i++) {
    const part = m[i];
    if (part.length > 1 && part.startsWith('0')) return null;
    const n = Number(part);
    if (n > 255) return null;
    v = (v << 8n) | BigInt(n);
  }
  return v;
}

export function hasLeadingZeroOctet(text: string): boolean {
  const m = V4_RE.exec(text.trim().split('/')[0]);
  if (!m) return false;
  return m.slice(1).some((p) => p.length > 1 && p.startsWith('0'));
}

/** Parses an IPv6 address (RFC 4291 text forms, including embedded IPv4). Zone IDs (%eth0) are rejected. */
export function parseIPv6(text: string): bigint | null {
  if (text.length === 0 || text.length > 45) return null;
  if (!/^[0-9A-Fa-f:.]+$/.test(text)) return null;
  const dbl = text.indexOf('::');
  if (dbl !== -1 && text.indexOf('::', dbl + 1) !== -1) return null;

  const parseSide = (side: string, allowV4Tail: boolean): number[] | null => {
    if (side === '') return [];
    const parts = side.split(':');
    const out: number[] = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (allowV4Tail && i === parts.length - 1 && p.includes('.')) {
        const v4 = parseIPv4(p);
        if (v4 === null) return null;
        out.push(Number((v4 >> 16n) & 0xffffn), Number(v4 & 0xffffn));
        continue;
      }
      if (!/^[0-9A-Fa-f]{1,4}$/.test(p)) return null;
      out.push(parseInt(p, 16));
    }
    return out;
  };

  let groups: number[];
  if (dbl === -1) {
    const g = parseSide(text, true);
    if (!g || g.length !== 8) return null;
    groups = g;
  } else {
    const left = parseSide(text.slice(0, dbl), false);
    const right = parseSide(text.slice(dbl + 2), true);
    if (!left || !right) return null;
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...new Array<number>(missing).fill(0), ...right];
  }
  let v = 0n;
  for (const g of groups) v = (v << 16n) | BigInt(g);
  return v;
}

export function parseIP(text: string): ParsedIP | null {
  const t = text.trim();
  if (t.includes(':')) {
    const v = parseIPv6(t);
    return v === null ? null : { family: 6, value: v, text: t };
  }
  const v = parseIPv4(t);
  return v === null ? null : { family: 4, value: v, text: t };
}

/** Parses "addr/prefix". Prefix must be decimal without leading zeros. */
export function parseCIDR(text: string): ParsedCIDR | null {
  const t = text.trim();
  const slash = t.indexOf('/');
  if (slash === -1 || slash !== t.lastIndexOf('/')) return null;
  const ip = parseIP(t.slice(0, slash));
  const ps = t.slice(slash + 1);
  if (!ip || !/^(0|[1-9]\d{0,2})$/.test(ps)) return null;
  const prefix = Number(ps);
  if (prefix > (ip.family === 4 ? 32 : 128)) return null;
  return { ...ip, prefix, text: t };
}

export function bits(f: Family): number {
  return f === 4 ? 32 : 128;
}

export function maskOf(f: Family, prefix: number): bigint {
  const b = BigInt(bits(f));
  if (prefix === 0) return 0n;
  return ((1n << b) - 1n) ^ ((1n << (b - BigInt(prefix))) - 1n);
}

export function networkOf(c: ParsedCIDR): bigint {
  return c.value & maskOf(c.family, c.prefix);
}

export function inSubnet(ip: ParsedIP, net: ParsedCIDR): boolean {
  if (ip.family !== net.family) return false;
  const m = maskOf(net.family, net.prefix);
  return (ip.value & m) === (net.value & m);
}

/** Converts a dotted netmask (e.g. 255.255.255.0) to a prefix length. Returns null for non-contiguous masks. */
export function netmaskToPrefix(mask: string): number | null {
  const v = parseIPv4(mask.trim());
  if (v === null) return null;
  let prefix = 0;
  let seenZero = false;
  for (let i = 31; i >= 0; i--) {
    const bit = (v >> BigInt(i)) & 1n;
    if (bit === 1n) {
      if (seenZero) return null;
      prefix++;
    } else seenZero = true;
  }
  return prefix;
}

function inRange(v: bigint, base: bigint, prefix: number, f: Family): boolean {
  const m = maskOf(f, prefix);
  return (v & m) === (base & m);
}

const V6 = (s: string) => parseIPv6(s) as bigint;
const V4 = (s: string) => parseIPv4(s) as bigint;

export function isIPv6LinkLocal(ip: ParsedIP): boolean {
  return ip.family === 6 && inRange(ip.value, V6('fe80::'), 10, 6);
}

export type AddrClass =
  | 'unspecified'
  | 'loopback'
  | 'multicast'
  | 'broadcast'
  | 'link-local'
  | 'reserved'
  | 'normal';

export function classify(ip: ParsedIP): AddrClass {
  const v = ip.value;
  if (ip.family === 4) {
    if (v === 0n) return 'unspecified';
    if (v === V4('255.255.255.255')) return 'broadcast';
    if (inRange(v, V4('0.0.0.0'), 8, 4)) return 'reserved';
    if (inRange(v, V4('127.0.0.0'), 8, 4)) return 'loopback';
    if (inRange(v, V4('224.0.0.0'), 4, 4)) return 'multicast';
    if (inRange(v, V4('240.0.0.0'), 4, 4)) return 'reserved';
    if (inRange(v, V4('169.254.0.0'), 16, 4)) return 'link-local';
    return 'normal';
  }
  if (v === 0n) return 'unspecified';
  if (v === 1n) return 'loopback';
  if (inRange(v, V6('ff00::'), 8, 6)) return 'multicast';
  if (inRange(v, V6('fe80::'), 10, 6)) return 'link-local';
  return 'normal';
}
