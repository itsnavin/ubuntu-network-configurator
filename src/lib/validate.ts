import {
  classify,
  hasLeadingZeroOctet,
  inSubnet,
  isIPv6LinkLocal,
  maskOf,
  parseCIDR,
  parseIP,
  type Family,
  type ParsedCIDR,
  type ParsedIP,
} from './ip';
import type { Config, Device, DhcpOverrides, Route } from './model';
import { KIND_LABEL } from './model';

export type Level = 'error' | 'warning' | 'info';

export interface Issue {
  level: Level;
  /** Field key used by the UI to attach inline messages, e.g. "d-1.addresses.0". */
  field: string;
  deviceUid?: string;
  message: string;
}

export const MAX_U32 = 4294967295;

export function parseIntStrict(s: string, min: number, max: number): number | null {
  const t = s.trim();
  if (!/^(0|[1-9]\d*)$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n < min || n > max) return null;
  return n;
}

export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,14}$/;
const MATCH_NAME_RE = /^[A-Za-z0-9_.\-*?[\]]{1,15}$/;
export const MAC_RE = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
const DOMAIN_LABEL = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/;
export const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.yaml$/;
const RESERVED_FILES = ['50-cloud-init.yaml', '00-installer-config.yaml', '01-network-manager-all.yaml', '01-netcfg.yaml'];

export function isValidDomain(s: string): boolean {
  const t = s.endsWith('.') ? s.slice(0, -1) : s;
  if (t.length === 0 || t.length > 253) return false;
  return t.split('.').every((l) => DOMAIN_LABEL.test(l));
}

export function isMulticastMac(mac: string): boolean {
  return (parseInt(mac.slice(0, 2), 16) & 1) === 1;
}

export function hasLoneSurrogate(s: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

export function validatePassphrase(pw: string): string | null {
  if (pw.length === 0) return 'A password is required for WPA-Personal / WPA3-Personal.';
  if (/^[0-9A-Fa-f]{64}$/.test(pw)) return null;
  if (!/^[\x20-\x7e]*$/.test(pw)) return 'Use printable ASCII characters only (space to ~). Non-ASCII passphrases are not portable between wpa_supplicant and NetworkManager.';
  if (pw.length < 8 || pw.length > 63) return `Passphrase must be 8–63 characters (currently ${pw.length}), or exactly 64 hexadecimal digits for a raw PSK.`;
  return null;
}

export function validateSsid(ssid: string): string | null {
  if (ssid.length === 0) return 'SSID is required.';
  if (hasLoneSurrogate(ssid)) return 'SSID contains an invalid Unicode character.';
  if (CONTROL_RE.test(ssid)) return 'SSID contains control characters, which cannot be configured safely here.';
  const n = utf8Length(ssid);
  if (n > 32) return `SSID is ${n} bytes in UTF-8; the 802.11 limit is 32 bytes.`;
  return null;
}

/** Overrides normalised for comparison; returns entries that are explicitly set. */
export function setOverrides(o: DhcpOverrides): Record<string, string> {
  const out: Record<string, string> = {};
  if (o.useDns !== 'default') out['use-dns'] = o.useDns;
  if (o.useNtp !== 'default') out['use-ntp'] = o.useNtp;
  if (o.useDomains !== 'default') out['use-domains'] = o.useDomains;
  if (o.useHostname !== 'default') out['use-hostname'] = o.useHostname;
  if (o.sendHostname !== 'default') out['send-hostname'] = o.sendHostname;
  if (o.useMtu !== 'default') out['use-mtu'] = o.useMtu;
  if (o.useRoutes !== 'default') out['use-routes'] = o.useRoutes;
  if (o.routeMetric.trim() !== '') out['route-metric'] = o.routeMetric.trim();
  if (o.hostname.trim() !== '') out['hostname'] = o.hostname.trim();
  return out;
}

export const NM_SUPPORTED_OVERRIDES = new Set(['use-routes', 'route-metric']);

export function hasIpConfig(d: Device): boolean {
  return d.dhcp4 || d.dhcp6 || d.addresses.length > 0 || d.routes.length > 0 || d.nameservers.length > 0 || d.search.length > 0;
}

function routeFamily(r: Route): Family | null {
  const to = r.to.trim();
  if (to !== 'default') {
    const c = parseCIDR(to) ?? parseIP(to);
    if (c) return c.family;
  }
  const via = parseIP(r.via);
  return via ? via.family : null;
}

export function validate(cfg: Config): Issue[] {
  const issues: Issue[] = [];
  const add = (level: Level, field: string, message: string, deviceUid?: string) =>
    issues.push({ level, field, message, deviceUid });
  const nm = cfg.renderer === 'NetworkManager';
  const byUid = new Map(cfg.devices.map((d) => [d.uid, d]));

  // ---- Global ----
  const fn = cfg.fileName.trim();
  if (!FILE_RE.test(fn)) {
    add('error', 'fileName', 'File name must end in .yaml and use only letters, digits, ".", "_" and "-" (no slashes or spaces).');
  } else {
    if (RESERVED_FILES.includes(fn) || /^90-NM-/.test(fn)) {
      add('error', 'fileName', `"${fn}" is a name commonly used by the installer, cloud-init or NetworkManager. Choose a new, unique file name so an existing file is not overwritten.`);
    }
    if (!/^\d{2}-/.test(fn)) add('warning', 'fileName', 'Netplan reads files in lexical order and later files override earlier ones. A two-digit prefix such as "60-" makes the order explicit.');
    else if (fn < '50-cloud-init.yaml') add('warning', 'fileName', 'This file sorts before 50-cloud-init.yaml, so a cloud-init file (if present) would override any keys it also defines.');
  }
  if (cfg.devices.length === 0) add('error', 'devices', 'Add at least one interface.');

  // ---- IDs ----
  const idCount = new Map<string, number>();
  for (const d of cfg.devices) {
    for (const name of [d.id.trim(), d.setName.trim()].filter(Boolean)) idCount.set(name, (idCount.get(name) ?? 0) + 1);
  }

  // Track addresses across devices for duplicate detection.
  const allAddrs: { dev: Device; c: ParsedCIDR; idx: number }[] = [];

  // Membership
  const owners = new Map<string, Device[]>();
  for (const d of cfg.devices) {
    if (d.kind !== 'bridge' && d.kind !== 'bond') continue;
    for (const m of new Set(d.members)) {
      owners.set(m, [...(owners.get(m) ?? []), d]);
    }
  }
  const vlanParents = new Set(cfg.devices.filter((d) => d.kind === 'vlan').map((d) => d.vlanLink));

  for (const d of cfg.devices) {
    const F = (f: string) => `${d.uid}.${f}`;
    const err = (f: string, m: string) => add('error', F(f), m, d.uid);
    const warn = (f: string, m: string) => add('warning', F(f), m, d.uid);
    const info = (f: string, m: string) => add('info', F(f), m, d.uid);
    const label = d.id.trim() || `(unnamed ${KIND_LABEL[d.kind]})`;
    const physical = d.kind === 'ethernet' || d.kind === 'wifi';
    const hasMatch = physical && (d.matchMac.trim() !== '' || d.matchName.trim() !== '');

    // ID
    const id = d.id.trim();
    if (!id) err('id', 'An ID / interface name is required.');
    else if (!ID_RE.test(id)) err('id', 'Use 1–15 characters: letters, digits, ".", "_" or "-", starting with a letter or digit (Linux interface name limit).');
    else if ((idCount.get(id) ?? 0) > 1) err('id', `"${id}" is used more than once. IDs and set-name values must be unique across the whole configuration.`);
    if (id && id !== d.id) err('id', 'Remove leading/trailing spaces.');

    // Match / set-name
    if (physical) {
      const mm = d.matchMac.trim();
      if (mm) {
        if (!MAC_RE.test(mm)) err('matchMac', 'MAC address must be six hex pairs separated by colons, e.g. 52:54:00:12:34:56.');
        else if (isMulticastMac(mm)) err('matchMac', 'This is a multicast MAC; permanent NIC addresses are unicast. Check `ip -br link`.');
      }
      const mn = d.matchName.trim();
      if (mn) {
        if (!MATCH_NAME_RE.test(mn)) err('matchName', 'Name match: 1–15 characters; letters, digits, "._-" and glob characters * ? [ ].');
        else if (/[*?[]/.test(mn) && d.addresses.length > 0) warn('matchName', 'This glob can match several NICs; every matching NIC would receive the same static address.');
        if (nm) info('matchName', 'NetworkManager supports name matching as of v1.14.');
      }
      const sn = d.setName.trim();
      if (sn) {
        if (!hasMatch) err('setName', 'set-name requires a match rule (MAC address or name) to identify the device.');
        if (!ID_RE.test(sn)) err('setName', 'set-name must be a valid interface name (1–15 characters: letters, digits, "._-").');
        else if ((idCount.get(sn) ?? 0) > 1) err('setName', `"${sn}" conflicts with another ID or set-name.`);
        if (/[*?[]/.test(mn) && !mm) warn('setName', 'Renaming with a glob match: only the first matching device can get this name; others fail to rename.');
      }
    }

    // MAC address override
    const mac = d.macaddress.trim();
    if (mac) {
      if (!MAC_RE.test(mac)) err('macaddress', 'MAC address must be six hex pairs separated by colons.');
      else if (isMulticastMac(mac)) err('macaddress', 'The first octet has the multicast bit set; an interface MAC must be unicast.');
      else if (!nm && physical && !d.matchMac.trim()) warn('macaddress', 'Netplan docs: with networkd, setting a MAC is unreliable for devices matched by name only. Add a MAC match.');
    }

    // MTU
    if (d.mtu.trim()) {
      const mtu = parseIntStrict(d.mtu, 68, 65535);
      if (mtu === null) err('mtu', 'MTU must be a whole number of bytes between 68 and 65535.');
      else {
        if (mtu < 1280 && (d.dhcp6 || d.addresses.some((a) => a.includes(':')))) warn('mtu', 'IPv6 requires an MTU of at least 1280 bytes.');
        if (mtu > 9216) warn('mtu', 'MTUs above 9216 are unusual; confirm the NIC, switch and every path support it.');
        if (!nm && physical && !d.matchMac.trim()) warn('mtu', 'Netplan docs: with networkd, MTU is unreliable for devices matched by name only. Add a MAC match.');
      }
    }

    if (d.optional && nm) err('optional', '"optional" is only supported by networkd. Turn it off or switch renderer.');
    if (d.ipv6AddressGeneration !== 'default' && !nm)
      err('ipv6AddressGeneration', 'The Netplan reference lists ipv6-address-generation as NetworkManager-only. netplan 0.107 (Ubuntu 22.04) rejects it with networkd. Leave it unset or switch renderer.');

    // Membership checks
    const myOwners = owners.get(d.uid) ?? [];
    const enslaved = myOwners.length > 0;
    if (myOwners.length > 1) {
      err('id', `${label} is a member of ${myOwners.map((o) => o.id || '(unnamed)').join(' and ')}. An interface can belong to only one bridge or bond.`);
    }
    if (enslaved && hasIpConfig(d)) {
      err('dhcp4', `${label} is a member of ${myOwners[0].id || 'a bridge/bond'}; put DHCP, addresses, routes and DNS on ${myOwners[0].id || 'the bridge/bond'} instead and leave members unaddressed.`);
    }

    // Addresses
    const myCidrs: ParsedCIDR[] = [];
    const seen = new Set<string>();
    d.addresses.forEach((a, i) => {
      const f = `addresses.${i}`;
      const t = a.trim();
      if (!t) return err(f, 'Empty address; remove the row or enter addr/prefix.');
      if (hasLeadingZeroOctet(t)) return err(f, 'IPv4 octets must not have leading zeros (e.g. use 192.168.1.10, not 192.168.001.010).');
      if (!t.includes('/')) return err(f, 'Add a prefix length, e.g. 192.168.1.10/24 or 2001:db8::10/64. Use the netmask converter if you have 255.255.255.0.');
      const c = parseCIDR(t);
      if (!c) return err(f, `"${t}" is not a valid IPv4/IPv6 address with prefix length.`);
      if (c.prefix === 0) return err(f, 'Prefix length 0 is not a valid interface address.');
      const cls = classify(c);
      if (cls === 'unspecified' || cls === 'loopback' || cls === 'multicast' || cls === 'broadcast' || cls === 'reserved')
        return err(f, `${t} is a ${cls} address and cannot be used as an interface address.`);
      if (cls === 'link-local')
        warn(f, c.family === 6 ? 'IPv6 link-local addresses are normally generated automatically; a static fe80:: address is only reachable on this link.' : '169.254.0.0/16 is IPv4 link-local (APIPA); it is only reachable on this link.');
      if (c.family === 4 && c.prefix <= 30) {
        const net = c.value & maskOf(4, c.prefix);
        const bcast = net | (((1n << 32n) - 1n) ^ maskOf(4, c.prefix));
        if (c.value === net) return err(f, `${t} is the network address of its subnet; choose a host address.`);
        if (c.value === bcast) return err(f, `${t} is the broadcast address of its subnet; choose a host address.`);
      }
      if (c.family === 4 && c.prefix === 32) info(f, '/32 means no on-link subnet: a gateway will need an explicit on-link route.');
      if (c.family === 6 && c.prefix === 128) info(f, '/128 means no on-link subnet: a gateway will need on-link or a link-local next hop.');
      const key = `${c.family}|${c.value}`;
      if (seen.has(key)) return err(f, `${t} is listed twice on this interface.`);
      seen.add(key);
      myCidrs.push(c);
      allAddrs.push({ dev: d, c, idx: i });
    });

    const hasV4 = d.dhcp4 || myCidrs.some((c) => c.family === 4);
    const hasV6 = d.dhcp6 || d.acceptRa !== 'false' || myCidrs.some((c) => c.family === 6);
    if (d.dhcp4 && myCidrs.some((c) => c.family === 4))
      info('addresses', 'DHCPv4 and static IPv4 are both enabled: the interface will have the static address in addition to the DHCP lease.');
    if (d.dhcp6 && myCidrs.some((c) => c.family === 6))
      info('addresses', 'DHCPv6 and static IPv6 are both enabled: the static address is added alongside DHCPv6/SLAAC addresses.');

    // IPv6 options
    if (d.linkLocal === 'none' && (d.dhcp6 || myCidrs.some((c) => c.family === 6)))
      warn('linkLocal', 'Disabling IPv6 link-local addresses breaks neighbour discovery and router advertisements for IPv6 on this link.');
    if (nm && d.linkLocal !== 'default' && (d.dhcp4 || d.dhcp6))
      info('linkLocal', 'Netplan docs: on NetworkManager, enabling link-local has no effect when DHCP is also enabled.');

    // DNS
    const nsSeen = new Set<string>();
    d.nameservers.forEach((n, i) => {
      const f = `nameservers.${i}`;
      const t = n.trim();
      if (hasLeadingZeroOctet(t)) return err(f, 'IPv4 octets must not have leading zeros.');
      const ip = parseIP(t);
      if (!ip) return err(f, `"${t}" is not a valid IPv4 or IPv6 address (no prefix length, no port).`);
      const cls = classify(ip);
      if (cls === 'unspecified' || cls === 'multicast' || cls === 'broadcast' || cls === 'reserved') return err(f, `${t} cannot be used as a DNS server.`);
      if (isIPv6LinkLocal(ip)) return err(f, 'Link-local DNS servers need an interface scope (%iface), which this app does not generate. Use a global or unique-local address.');
      if (nsSeen.has(ip.text)) warn(f, 'Duplicate DNS server.');
      nsSeen.add(ip.text);
    });
    if (d.nameservers.length > 3) warn('nameservers', 'More than 3 DNS servers: systemd-resolved accepts them, but the classic resolv.conf/glibc limit is 3.');
    d.search.forEach((s, i) => {
      if (!isValidDomain(s.trim())) err(`search.${i}`, `"${s}" is not a valid DNS domain (labels 1–63 of letters, digits, "-"; total ≤253).`);
    });
    if ((d.nameservers.length || d.search.length) && !d.dhcp4 && !d.dhcp6 && myCidrs.length === 0 && !enslaved)
      warn('nameservers', 'DNS is set but this interface has no addresses or DHCP, so the DNS servers may be unreachable through it.');

    // DHCP overrides
    const ov4 = setOverrides(d.dhcp4Overrides);
    const ov6 = setOverrides(d.dhcp6Overrides);
    for (const [fam, ov, enabled, raw] of [
      [4, ov4, d.dhcp4, d.dhcp4Overrides],
      [6, ov6, d.dhcp6, d.dhcp6Overrides],
    ] as const) {
      const f = `dhcp${fam}Overrides`;
      const keys = Object.keys(ov);
      if (keys.length && !enabled) err(f, `dhcp${fam}-overrides are set but DHCPv${fam} is off. Overrides only take effect when dhcp${fam} is true; reset them or enable DHCP.`);
      if (nm) {
        const bad = keys.filter((k) => !NM_SUPPORTED_OVERRIDES.has(k));
        if (bad.length) err(f, `${bad.join(', ')} only take effect with networkd (Netplan docs). With NetworkManager only use-routes and route-metric are honoured; reset the others.`);
      }
      if (raw.routeMetric.trim() && parseIntStrict(raw.routeMetric, 0, MAX_U32) === null)
        err(`${f}.routeMetric`, 'Route metric must be a whole number from 0 to 4294967295.');
      if (raw.hostname.trim() && !isValidDomain(raw.hostname.trim()))
        err(`${f}.hostname`, 'Hostname must be a valid DNS name.');
    }
    if (!nm && d.dhcp4 && d.dhcp6 && JSON.stringify(sortKeys(ov4)) !== JSON.stringify(sortKeys(ov6)))
      err('dhcp6Overrides', 'networkd requires dhcp4-overrides and dhcp6-overrides to contain the same keys and values when both DHCPv4 and DHCPv6 are enabled. Make them identical.');
    if (d.dhcpIdentifier !== 'default') {
      if (nm) err('dhcpIdentifier', 'dhcp-identifier is networkd only.');
      else if (!d.dhcp4) warn('dhcpIdentifier', 'dhcp-identifier affects DHCPv4 only, which is off.');
    }

    // Routes
    d.routes.forEach((r) => {
      const f = (x: string) => `routes.${r.uid}.${x}`;
      const to = r.to.trim();
      let toNet: ParsedCIDR | null = null;
      if (to !== 'default') {
        if (hasLeadingZeroOctet(to)) return err(f('to'), 'IPv4 octets must not have leading zeros.');
        const c = parseCIDR(to);
        const plain = c ? null : parseIP(to);
        if (!c && !plain) return err(f('to'), 'Destination must be "default" or a network like 10.20.0.0/16 / 2001:db8:1::/48.');
        toNet = c ?? { ...(plain as ParsedIP), prefix: plain!.family === 4 ? 32 : 128 };
        if (toNet.prefix === 0) info(f('to'), `${to} is a default route; it is treated like "default".`);
        if ((toNet.value & maskOf(toNet.family, toNet.prefix)) !== toNet.value)
          return err(f('to'), `${to} has host bits set. Use the network address (e.g. 10.20.0.0/16).`);
      }
      const viaT = r.via.trim();
      let via: ParsedIP | null = null;
      if (viaT) {
        if (hasLeadingZeroOctet(viaT)) return err(f('via'), 'IPv4 octets must not have leading zeros.');
        via = parseIP(viaT);
        if (!via) return err(f('via'), `"${viaT}" is not a valid gateway IP address.`);
        const cls = classify(via);
        if (cls !== 'normal' && cls !== 'link-local') return err(f('via'), `${viaT} (${cls}) cannot be a gateway.`);
        if (toNet && toNet.family !== via.family) return err(f('via'), 'Gateway and destination must be the same IP family.');
        if (myCidrs.some((c) => c.family === via!.family && c.value === via!.value)) return err(f('via'), 'The gateway is this interface\'s own address.');
      } else {
        return err(
          f('via'),
          to === 'default'
            ? 'A default route needs a gateway (via).'
            : 'This app requires a gateway (via) for every route. Netplan itself accepts a route without via (a directly attached "scope link" route), but networks on this link are already reachable through the interface address, so such a route is rarely needed and is not offered here.',
        );
      }
      const fam = routeFamily(r);
      if (fam === 4 && !hasV4) err(f('to'), 'This IPv4 route is on an interface with no IPv4 address or DHCPv4.');
      if (fam === 6 && !hasV6) err(f('to'), 'This IPv6 route is on an interface with no IPv6 addressing (static, DHCPv6 or RA).');
      if (via) {
        const inStatic = myCidrs.some((c) => inSubnet(via!, c));
        if (isIPv6LinkLocal(via)) info(f('via'), 'Link-local next hop: it is only meaningful on this interface, which Netplan scopes automatically.');
        else if (r.onLink) {
          if (inStatic) info(f('onLink'), 'The gateway is already inside a configured subnet; on-link is not needed.');
          else warn(f('onLink'), 'on-link tells the kernel the gateway is directly reachable even though it is outside your subnets. Use only when your provider documents it (e.g. /32 cloud setups).');
          if (nm) info(f('onLink'), `NetworkManager supports on-link as of ${via.family === 4 ? 'v1.12 (IPv4)' : 'v1.18 (IPv6)'}.`);
        } else if (!inStatic) {
          const dyn = via.family === 4 ? d.dhcp4 : d.dhcp6 || d.acceptRa !== 'false';
          if (dyn) warn(f('via'), 'The gateway is not inside a static subnet on this interface. It may be reachable via a DHCP/RA prefix, which cannot be checked here.');
          else err(f('via'), `Gateway ${viaT} is not inside any subnet configured on ${label}, so it is not reachable as a next hop. Fix the address/prefix, or enable on-link only if the gateway really is directly attached.`);
        }
      }
      if (r.metric.trim() && parseIntStrict(r.metric, 0, MAX_U32) === null) err(f('metric'), 'Metric must be a whole number from 0 to 4294967295 (lower = preferred).');
      if (r.table.trim()) {
        const t = parseIntStrict(r.table, 1, MAX_U32);
        if (t === null) err(f('table'), 'Table must be a whole number from 1 to 4294967295.');
        else if (t === 254) info(f('table'), 'Table 254 is the main table, the same as leaving this empty.');
        else if (t === 253 || t === 255) err(f('table'), `Table ${t} is reserved (${t === 255 ? 'local' : 'default'}). Use 1–252 or 256+.`);
        else warn(f('table'), 'Routes in a custom table are only used when a routing-policy rule points to it. This app does not generate routing-policy rules; add them yourself if needed.');
        if (nm) info(f('table'), 'NetworkManager supports route tables as of v1.10.');
      }
    });

    // Kind specific
    if (d.kind === 'wifi') {
      if (d.accessPoints.length === 0) err('accessPoints', 'Add at least one Wi-Fi network (SSID).');
      if (!nm) info('accessPoints', 'networkd has no native Wi-Fi support; Netplan uses wpa_supplicant (package "wpasupplicant") for it. Check it is installed before relying on this.');
      const ssids = new Set<string>();
      d.accessPoints.forEach((ap) => {
        const f = (x: string) => `ap.${ap.uid}.${x}`;
        const se = validateSsid(ap.ssid);
        if (se) err(f('ssid'), se);
        else {
          if (ssids.has(ap.ssid)) err(f('ssid'), 'This SSID is listed twice on the same interface.');
          ssids.add(ap.ssid);
          if (ap.ssid !== ap.ssid.trim()) warn(f('ssid'), 'SSID has leading/trailing spaces; they are kept exactly as typed.');
        }
        if (ap.security === 'open') {
          if (ap.password) err(f('password'), 'A password is entered but security is "Open". Choose WPA2/WPA3-Personal or clear the password.');
          warn(f('security'), 'Open networks are unencrypted; anyone nearby can read the traffic.');
        } else {
          const pe = validatePassphrase(ap.password);
          if (pe) err(f('password'), pe);
          else if (ap.password !== ap.password.trim()) warn(f('password'), 'Password has leading/trailing spaces; they are kept exactly as typed.');
          if (ap.security === 'sae') info(f('security'), 'WPA3-Personal (SAE) needs driver and wpa_supplicant/NetworkManager support.');
        }
        if (ap.channel.trim()) {
          if (ap.band === 'any') err(f('channel'), 'A channel only takes effect when a band is selected (Netplan docs). Pick 2.4GHz or 5GHz, or clear the channel.');
          else {
            const ch = ap.band === '2.4GHz' ? parseIntStrict(ap.channel, 1, 14) : parseIntStrict(ap.channel, 32, 177);
            if (ch === null) err(f('channel'), ap.band === '2.4GHz' ? '2.4GHz channels are 1–14.' : '5GHz channels are 32–177.');
          }
        }
        const b = ap.bssid.trim();
        if (b && !MAC_RE.test(b)) err(f('bssid'), 'BSSID must be a MAC address like aa:bb:cc:dd:ee:ff.');
      });
      if (enslaved) err('id', 'Wi-Fi client interfaces cannot be bridge or bond members in this app (most Wi-Fi drivers cannot bridge in client mode).');
    }

    if (d.kind === 'bridge' || d.kind === 'bond') {
      const seenM = new Set<string>();
      d.members.forEach((m, i) => {
        const f = `members.${i}`;
        const md = byUid.get(m);
        if (seenM.has(m)) err(f, 'Member listed twice.');
        seenM.add(m);
        if (!md) return err(f, 'This member no longer exists (it was deleted). Remove it from the list.');
        if (md.uid === d.uid) return err(f, 'A device cannot be a member of itself.');
        const ok = d.kind === 'bond' ? md.kind === 'ethernet' : ['ethernet', 'bond', 'vlan'].includes(md.kind);
        if (!ok) err(f, d.kind === 'bond' ? `Bond members must be Ethernet interfaces (${md.id || 'member'} is ${KIND_LABEL[md.kind]}).` : `Bridge members must be Ethernet, bond or VLAN devices (${md.id || 'member'} is ${KIND_LABEL[md.kind]}).`);
      });
      if (d.members.length === 0)
        (d.kind === 'bond' ? warn : info)('members', d.kind === 'bond' ? 'A bond without members has no connectivity.' : 'A bridge without members is created but has no physical connectivity (useful only for VMs/containers).');
    }

    if (d.kind === 'bridge') {
      if (d.bridgePriority.trim() && parseIntStrict(d.bridgePriority, 0, 65535) === null) err('bridgePriority', 'Bridge priority must be 0–65535 (lower wins root election).');
      if (d.bridgeForwardDelay.trim()) {
        const fd = parseIntStrict(d.bridgeForwardDelay, 0, 30);
        if (fd === null) err('bridgeForwardDelay', 'Forward delay must be 0–30 seconds.');
        else if (fd < 2 && d.bridgeStp !== 'false') warn('bridgeForwardDelay', 'With STP enabled the kernel requires a forward delay of 2–30 seconds.');
      }
    }

    if (d.kind === 'bond') {
      const m = d.bondMode;
      if (d.bondLacpRate !== 'default' && m !== '802.3ad') err('bondLacpRate', 'lacp-rate is only used in 802.3ad mode.');
      if (d.bondTransmitHashPolicy !== 'default' && !['balance-xor', '802.3ad', 'balance-tlb'].includes(m))
        err('bondTransmitHashPolicy', 'transmit-hash-policy is only used in balance-xor, 802.3ad and balance-tlb modes.');
      if (d.bondPrimary) {
        if (!['active-backup', 'balance-tlb', 'balance-alb'].includes(m)) err('bondPrimary', 'primary only applies to active-backup, balance-tlb and balance-alb.');
        if (!d.members.includes(d.bondPrimary)) err('bondPrimary', 'The primary interface must be one of the bond members.');
      }
      if (d.bondMiiMonitorInterval.trim()) {
        const mii = parseIntStrict(d.bondMiiMonitorInterval, 0, 2147483647);
        if (mii === null) err('bondMiiMonitorInterval', 'MII monitor interval must be a whole number of milliseconds.');
        else if (mii === 0) warn('bondMiiMonitorInterval', '0 disables link monitoring; failed members will not be detected.');
      } else warn('bondMiiMonitorInterval', 'No MII monitor interval: link failures will not be detected (kernel default is 0 = off). 100 ms is common.');
      if (m === '802.3ad') info('bondMode', '802.3ad (LACP) requires a matching LACP port-channel on the switch.');
      if (['balance-rr', 'balance-xor', 'broadcast'].includes(m)) info('bondMode', `${m} needs a static link aggregation group (EtherChannel) configured on the switch.`);
    }

    if (d.kind === 'vlan') {
      const vid = parseIntStrict(d.vlanId, 1, 4094);
      if (vid === null) err('vlanId', 'VLAN ID must be a whole number from 1 to 4094.');
      else if (vid === 1) warn('vlanId', 'VLAN 1 is the default/native VLAN on many switches and is often untagged.');
      if (!d.vlanLink) err('vlanLink', 'Choose the parent (link) device.');
      else {
        const p = byUid.get(d.vlanLink);
        if (!p) err('vlanLink', 'The parent device no longer exists.');
        else {
          if (p.uid === d.uid) err('vlanLink', 'A VLAN cannot be its own parent.');
          else if (!['ethernet', 'bond', 'bridge'].includes(p.kind)) err('vlanLink', `VLAN parent must be Ethernet, bond or bridge (${p.id || 'parent'} is ${KIND_LABEL[p.kind]}).`);
          const pOwners = owners.get(p.uid) ?? [];
          if (pOwners.some((o) => o.kind === 'bond')) err('vlanLink', `${p.id} is a bond member; create the VLAN on the bond (${pOwners[0].id}) instead.`);
          else if (pOwners.length) warn('vlanLink', `${p.id} is also a bridge port. Tagged traffic may be ambiguous; usually the VLAN is created on the bridge or the bridge contains the VLAN.`);
        }
      }
    }

    // Unaddressed devices
    if (!enslaved && !hasIpConfig(d) && d.acceptRa !== 'true') {
      if (vlanParents.has(d.uid)) info('dhcp4', `${label} has no IP configuration; that is fine for a VLAN parent that only carries tagged traffic.`);
      else warn('dhcp4', `${label} has no DHCP or static address: the link is brought up but will not be reachable over IP.`);
    }
  }

  // Duplicate IPs across devices
  for (let i = 0; i < allAddrs.length; i++) {
    for (let j = i + 1; j < allAddrs.length; j++) {
      const a = allAddrs[i];
      const b = allAddrs[j];
      if (a.dev !== b.dev && a.c.family === b.c.family && a.c.value === b.c.value) {
        add('error', `${b.dev.uid}.addresses.${b.idx}`, `${b.c.text} is also configured on ${a.dev.id || 'another interface'}. Duplicate addresses cause ARP/ND conflicts.`, b.dev.uid);
      }
    }
  }

  // Cycles (bridge/bond membership + VLAN parent edges)
  const edges = new Map<string, string[]>();
  for (const d of cfg.devices) {
    const out: string[] = [];
    if (d.kind === 'bridge' || d.kind === 'bond') out.push(...d.members);
    if (d.kind === 'vlan' && d.vlanLink) out.push(d.vlanLink);
    edges.set(d.uid, out.filter((u) => byUid.has(u)));
  }
  const state = new Map<string, 0 | 1 | 2>();
  const reported = new Set<string>();
  const dfs = (u: string, path: string[]): void => {
    state.set(u, 1);
    for (const v of edges.get(u) ?? []) {
      if (state.get(v) === 1) {
        const cyc = [...path.slice(path.indexOf(v)), v].map((x) => byUid.get(x)?.id || '?');
        const key = [...new Set(cyc)].sort().join('|');
        if (!reported.has(key)) {
          reported.add(key);
          add('error', `${u}.members`, `Circular dependency: ${cyc.join(' → ')}. Devices cannot (indirectly) contain themselves.`, u);
        }
      } else if (!state.get(v)) dfs(v, [...path, v]);
    }
    state.set(u, 2);
  };
  for (const d of cfg.devices) if (!state.get(d.uid)) dfs(d.uid, [d.uid]);

  // Route ambiguity across the whole configuration
  type RK = { dev: Device; r: Route; fam: Family; key: string; metric: string; isDefault: boolean };
  const rks: RK[] = [];
  for (const d of cfg.devices) {
    for (const r of d.routes) {
      const fam = routeFamily(r);
      if (!fam) continue;
      const to = r.to.trim();
      let isDefault = to === 'default';
      let dest = 'default';
      if (!isDefault) {
        const c = parseCIDR(to) ?? (parseIP(to) ? { ...(parseIP(to) as ParsedIP), prefix: fam === 4 ? 32 : 128 } : null);
        if (!c) continue;
        if (c.prefix === 0) isDefault = true;
        else dest = `${c.value}/${c.prefix}`;
      }
      const table = r.table.trim() || '254';
      rks.push({ dev: d, r, fam, key: `${fam}|${dest}|${table}`, metric: r.metric.trim() === '' ? '' : String(Number(r.metric.trim())), isDefault });
    }
  }
  const groups = new Map<string, RK[]>();
  for (const rk of rks) groups.set(rk.key, [...(groups.get(rk.key) ?? []), rk]);
  for (const [, g] of groups) {
    if (g.length < 2) continue;
    for (const rk of g.slice(1)) {
      const f = `${rk.dev.uid}.routes.${rk.r.uid}.to`;
      const other = g.find((o) => o !== rk && o.metric === rk.metric);
      const where = (other ?? g[0]).dev.id || 'another interface';
      if (other) {
        add(
          'error',
          f,
          rk.isDefault
            ? `A second IPv${rk.fam} default route with the same table and metric (also on ${where}). Netplan only warns about conflicting default routes, but which gateway is used becomes unpredictable. Keep one, or give them different metrics (lower = preferred).`
            : `Duplicate route to ${rk.r.to} with the same metric and table (also on ${where}). This is ambiguous; give them different metrics or remove one.`,
          rk.dev.uid,
        );
      } else {
        add(
          'warning',
          f,
          rk.isDefault
            ? `Several IPv${rk.fam} default routes with different metrics (also on ${where}): the lowest metric is used while its link is up; the others are fallbacks. The kernel does not check whether a gateway actually forwards traffic.`
            : `Another route to ${rk.r.to} exists in the same table with a different metric; the lower metric wins while its interface is up.`,
          rk.dev.uid,
        );
      }
    }
  }
  // Static default + DHCP-supplied default
  for (const rk of rks.filter((x) => x.isDefault && (x.r.table.trim() === '' || x.r.table.trim() === '254'))) {
    for (const d of cfg.devices) {
      const dhcp = rk.fam === 4 ? d.dhcp4 : d.dhcp6;
      const ov = rk.fam === 4 ? d.dhcp4Overrides : d.dhcp6Overrides;
      if (dhcp && ov.useRoutes !== 'false') {
        add('warning', `${rk.dev.uid}.routes.${rk.r.uid}.to`, `${d.id || 'An interface'} also uses DHCPv${rk.fam}, which normally installs its own default route. Set a metric on one of them, or set DHCP use-routes to false, so the preferred path is explicit.`, rk.dev.uid);
        break;
      }
    }
  }

  return issues;
}

function sortKeys(o: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

export function counts(issues: Issue[]): Record<Level, number> {
  return {
    error: issues.filter((i) => i.level === 'error').length,
    warning: issues.filter((i) => i.level === 'warning').length,
    info: issues.filter((i) => i.level === 'info').length,
  };
}
