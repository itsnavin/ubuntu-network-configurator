import type { Config, Device, DhcpOverrides } from './model';
import { KIND_SECTION } from './model';
import { emitYaml, fixed, userKey, ybool, yint, ymap, yseq, ystr, type YEntry, type YNode } from './yaml';

export const SECRET_MASK = '<hidden Wi-Fi password>';

export interface GenerateOptions {
  /** Replace Wi-Fi passwords with a mask (used for the on-screen preview). */
  maskSecrets?: boolean;
}

const triBool = (t: 'true' | 'false') => ybool(t === 'true');

function overridesNode(o: DhcpOverrides): YNode | null {
  const e: YEntry[] = [];
  if (o.useDns !== 'default') e.push(fixed('use-dns', triBool(o.useDns)));
  if (o.useNtp !== 'default') e.push(fixed('use-ntp', triBool(o.useNtp)));
  if (o.useDomains !== 'default') e.push(fixed('use-domains', o.useDomains === 'route' ? ystr('route') : triBool(o.useDomains)));
  if (o.useHostname !== 'default') e.push(fixed('use-hostname', triBool(o.useHostname)));
  if (o.sendHostname !== 'default') e.push(fixed('send-hostname', triBool(o.sendHostname)));
  if (o.hostname.trim()) e.push(fixed('hostname', ystr(o.hostname.trim())));
  if (o.useMtu !== 'default') e.push(fixed('use-mtu', triBool(o.useMtu)));
  if (o.useRoutes !== 'default') e.push(fixed('use-routes', triBool(o.useRoutes)));
  if (o.routeMetric.trim()) e.push(fixed('route-metric', yint(Number(o.routeMetric.trim()))));
  return e.length ? ymap(e) : null;
}

function idOf(cfg: Config, uid: string): string {
  const d = cfg.devices.find((x) => x.uid === uid);
  if (!d) throw new Error('Dangling device reference');
  return d.id.trim();
}

export function deviceNode(cfg: Config, d: Device, opts: GenerateOptions = {}): YNode {
  const e: YEntry[] = [];
  const physical = d.kind === 'ethernet' || d.kind === 'wifi';

  if (physical) {
    const m: YEntry[] = [];
    if (d.matchMac.trim()) m.push(fixed('macaddress', ystr(d.matchMac.trim())));
    if (d.matchName.trim()) m.push(fixed('name', ystr(d.matchName.trim())));
    if (m.length) e.push(fixed('match', ymap(m)));
    if (d.setName.trim()) e.push(fixed('set-name', ystr(d.setName.trim())));
  }
  if (d.macaddress.trim()) e.push(fixed('macaddress', ystr(d.macaddress.trim())));
  if (d.mtu.trim()) e.push(fixed('mtu', yint(Number(d.mtu.trim()))));
  if (d.optional) e.push(fixed('optional', ybool(true)));

  e.push(fixed('dhcp4', ybool(d.dhcp4)));
  e.push(fixed('dhcp6', ybool(d.dhcp6)));
  if (d.dhcpIdentifier !== 'default') e.push(fixed('dhcp-identifier', ystr(d.dhcpIdentifier)));
  if (d.dhcp4) {
    const o = overridesNode(d.dhcp4Overrides);
    if (o) e.push(fixed('dhcp4-overrides', o));
  }
  if (d.dhcp6) {
    const o = overridesNode(d.dhcp6Overrides);
    if (o) e.push(fixed('dhcp6-overrides', o));
  }
  if (d.acceptRa !== 'default') e.push(fixed('accept-ra', triBool(d.acceptRa)));
  if (d.linkLocal !== 'default') {
    const ll = { ipv6: ['ipv6'], ipv4: ['ipv4'], both: ['ipv4', 'ipv6'], none: [] as string[] }[d.linkLocal];
    e.push(fixed('link-local', yseq(ll.map(ystr))));
  }
  if (d.ipv6Privacy) e.push(fixed('ipv6-privacy', ybool(true)));
  if (d.ipv6AddressGeneration !== 'default') e.push(fixed('ipv6-address-generation', ystr(d.ipv6AddressGeneration)));

  if (d.addresses.length) e.push(fixed('addresses', yseq(d.addresses.map((a) => ystr(a.trim())))));

  if (d.nameservers.length || d.search.length) {
    const ns: YEntry[] = [];
    if (d.search.length) ns.push(fixed('search', yseq(d.search.map((s) => ystr(s.trim())))));
    if (d.nameservers.length) ns.push(fixed('addresses', yseq(d.nameservers.map((s) => ystr(s.trim())))));
    e.push(fixed('nameservers', ymap(ns)));
  }

  if (d.routes.length) {
    e.push(
      fixed(
        'routes',
        yseq(
          d.routes.map((r) => {
            const re: YEntry[] = [fixed('to', ystr(r.to.trim()))];
            if (r.via.trim()) re.push(fixed('via', ystr(r.via.trim())));
            if (r.onLink) re.push(fixed('on-link', ybool(true)));
            if (r.metric.trim()) re.push(fixed('metric', yint(Number(r.metric.trim()))));
            if (r.table.trim()) re.push(fixed('table', yint(Number(r.table.trim()))));
            return ymap(re);
          }),
        ),
      ),
    );
  }

  if (d.kind === 'wifi') {
    const aps: YEntry[] = d.accessPoints.map((ap) => {
      const a: YEntry[] = [];
      const pw = opts.maskSecrets && ap.password ? SECRET_MASK : ap.password;
      if (ap.security === 'psk') {
        a.push(fixed('auth', ymap([fixed('key-management', ystr('psk')), fixed('password', ystr(pw))])));
      } else if (ap.security === 'sae') {
        a.push(fixed('auth', ymap([fixed('key-management', ystr('sae')), fixed('password', ystr(pw))])));
      }
      if (ap.hidden) a.push(fixed('hidden', ybool(true)));
      if (ap.band !== 'any') a.push(fixed('band', ystr(ap.band)));
      if (ap.band !== 'any' && ap.channel.trim()) a.push(fixed('channel', yint(Number(ap.channel.trim()))));
      if (ap.bssid.trim()) a.push(fixed('bssid', ystr(ap.bssid.trim())));
      return userKey(ap.ssid, ymap(a));
    });
    e.push(fixed('access-points', ymap(aps)));
  }

  if (d.kind === 'bridge' || d.kind === 'bond') {
    e.push(fixed('interfaces', yseq(d.members.map((m) => ystr(idOf(cfg, m))))));
  }
  if (d.kind === 'bridge') {
    const p: YEntry[] = [];
    if (d.bridgeStp !== 'default') p.push(fixed('stp', triBool(d.bridgeStp)));
    if (d.bridgeForwardDelay.trim()) p.push(fixed('forward-delay', yint(Number(d.bridgeForwardDelay.trim()))));
    if (d.bridgePriority.trim()) p.push(fixed('priority', yint(Number(d.bridgePriority.trim()))));
    if (p.length) e.push(fixed('parameters', ymap(p)));
  }
  if (d.kind === 'bond') {
    const p: YEntry[] = [fixed('mode', ystr(d.bondMode))];
    if (d.bondLacpRate !== 'default') p.push(fixed('lacp-rate', ystr(d.bondLacpRate)));
    if (d.bondMiiMonitorInterval.trim()) p.push(fixed('mii-monitor-interval', yint(Number(d.bondMiiMonitorInterval.trim()))));
    if (d.bondTransmitHashPolicy !== 'default') p.push(fixed('transmit-hash-policy', ystr(d.bondTransmitHashPolicy)));
    if (d.bondPrimary) p.push(fixed('primary', ystr(idOf(cfg, d.bondPrimary))));
    e.push(fixed('parameters', ymap(p)));
  }
  if (d.kind === 'vlan') {
    e.push(fixed('id', yint(Number(d.vlanId.trim()))));
    e.push(fixed('link', ystr(idOf(cfg, d.vlanLink))));
  }
  return ymap(e);
}

export function buildTree(cfg: Config, opts: GenerateOptions = {}): YNode {
  const net: YEntry[] = [fixed('version', yint(2)), fixed('renderer', ystr(cfg.renderer))];
  for (const kind of ['ethernet', 'wifi', 'bond', 'bridge', 'vlan'] as const) {
    const devs = cfg.devices.filter((d) => d.kind === kind);
    if (!devs.length) continue;
    net.push(fixed(KIND_SECTION[kind], ymap(devs.map((d) => userKey(d.id.trim(), deviceNode(cfg, d, opts))))));
  }
  return ymap([fixed('network', ymap(net))]);
}

export const HEADER = [
  'Generated offline by Ubuntu Network Configurator. REVIEW BEFORE USE.',
  'This file is merged with every other file in /etc/netplan, /run/netplan and /lib/netplan.',
  'Validate with "sudo netplan generate", test with "sudo netplan try" from a local console.',
  'Install with permissions 600 (root only): it may contain Wi-Fi passwords.',
];

export function generateYaml(cfg: Config, opts: GenerateOptions = {}): string {
  return emitYaml(buildTree(cfg, opts), HEADER);
}
