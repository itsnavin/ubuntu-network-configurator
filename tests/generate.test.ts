import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { SECRET_MASK, generateYaml } from '../src/lib/generate';
import { defaultConfig, emptyOverrides, newAccessPoint, newDevice, newRoute, type Config } from '../src/lib/model';
import { PRESETS } from '../src/lib/presets';
import { validate } from '../src/lib/validate';
import { SCENARIOS, TEST_PASSWORD_TRICKY, TEST_SSID_TRICKY } from './scenarios';

const gen = (cfg: Config, maskSecrets = false) => parse(generateYaml(cfg, { maskSecrets }));
const errorsOf = (cfg: Config) => validate(cfg).filter((i) => i.level === 'error');

describe('scenarios', () => {
  it.each(SCENARIOS.map((s) => [s.name, s] as const))('%s validates without errors and parses', (_n, s) => {
    const cfg = s.build();
    expect(errorsOf(cfg)).toEqual([]);
    const y = generateYaml(cfg);
    const js = parse(y);
    expect(js.network.version).toBe(2);
    expect(js.network.renderer).toBe(cfg.renderer);
    expect(y).not.toMatch(/gateway[46]/);
  });
  it.each(PRESETS.map((p) => [p.key, p] as const))('preset %s is valid apart from required user input', (_k, p) => {
    const errs = errorsOf(p.build());
    // The Wi-Fi preset deliberately has an empty password for the user to fill in.
    if (p.key === 'wifi') expect(errs.map((e) => e.field.split('.').pop())).toEqual(['password']);
    else expect(errs).toEqual([]);
  });
});

describe('DHCP and static addressing', () => {
  it('always writes explicit dhcp4/dhcp6 booleans', () => {
    const js = gen(PRESETS.find((p) => p.key === 'static-ipv4')!.build());
    const e = js.network.ethernets.enp3s0;
    expect(e.dhcp4).toBe(false);
    expect(e.dhcp6).toBe(false);
    expect(e.addresses).toEqual(['192.168.1.50/24']);
    expect(e.routes).toEqual([{ to: 'default', via: '192.168.1.1' }]);
    expect(e.nameservers).toEqual({ search: ['example.lan'], addresses: ['192.168.1.1', '1.1.1.1'] });
  });
  it('allows DHCP and static addresses together with an explanatory note', () => {
    const d = newDevice('ethernet', 'eth0', { dhcp4: true, addresses: ['192.168.1.5/24'] });
    const cfg = { ...defaultConfig(), devices: [d] };
    const issues = validate(cfg);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(issues.some((i) => i.level === 'info' && /in addition to the DHCP lease/.test(i.message))).toBe(true);
    expect(gen(cfg).network.ethernets.eth0).toMatchObject({ dhcp4: true, addresses: ['192.168.1.5/24'] });
  });
  it('emits IPv6 options', () => {
    const js = gen(SCENARIOS.find((s) => s.name === 'advanced-ethernet-networkd')!.build());
    const e = js.network.ethernets.lan;
    expect(e['accept-ra']).toBe(true);
    expect(e['link-local']).toEqual(['ipv4', 'ipv6']);
    expect(e['ipv6-privacy']).toBe(true);
    expect(e['ipv6-address-generation']).toBeUndefined();
    const nm = gen(SCENARIOS.find((s) => s.name === 'nm-overrides-match-name')!.build());
    expect(nm.network.ethernets.uplink['ipv6-address-generation']).toBe('stable-privacy');
    expect(e.match).toEqual({ macaddress: '52:54:00:12:34:56' });
    expect(e['set-name']).toBe('lan0');
    expect(e.mtu).toBe(9000);
    expect(e.optional).toBe(true);
    expect(e['dhcp-identifier']).toBe('mac');
    expect(e['dhcp4-overrides']).toEqual(e['dhcp6-overrides']);
    expect(e['dhcp4-overrides']).toMatchObject({ 'use-dns': false, 'use-domains': 'route', 'route-metric': 50, hostname: 'server-01' });
    expect(e.routes).toContainEqual({ to: '172.16.0.0/12', via: '10.0.0.254', metric: 0 });
    expect(e.routes).toContainEqual({ to: '192.168.200.0/24', via: '10.0.0.253', metric: 300, table: 100 });
    expect(e.routes).toContainEqual({ to: 'fd00:99::/48', via: 'fe80::1' });
    expect(e.nameservers.search).toEqual(['example.lan', 'no']);
  });
  it('preserves string forms such as IPv6 and MACs exactly', () => {
    const y = generateYaml(SCENARIOS.find((s) => s.name === 'dual-stack-networkd')!.build());
    expect(y).toContain('"2001:db8:10::10/64"');
    expect(y).toContain('"2001:db8:10::1"');
  });
  it('emits on-link only when requested', () => {
    const js = gen(SCENARIOS.find((s) => s.name === 'onlink-cloud-networkd')!.build());
    expect(js.network.ethernets.eth0.routes).toEqual([
      { to: 'default', via: '172.31.1.1', 'on-link': true },
      { to: 'default', via: 'fe80::1' },
    ]);
  });
  it('does not emit overrides for a disabled DHCP family', () => {
    const d = newDevice('ethernet', 'eth0', { dhcp4: true, dhcp6: false, dhcp6Overrides: { ...emptyOverrides(), useRoutes: 'false' } });
    const cfg = { ...defaultConfig(), devices: [d] };
    expect(gen(cfg).network.ethernets.eth0['dhcp6-overrides']).toBeUndefined();
    expect(errorsOf(cfg).some((e) => e.field.endsWith('dhcp6Overrides'))).toBe(true);
  });
});

describe('virtual devices', () => {
  it('generates bond, VLAN and bridge references by ID', () => {
    const js = gen(PRESETS.find((p) => p.key === 'vm-host')!.build());
    expect(js.network.bonds.bond0.interfaces).toEqual(['eno1', 'eno2']);
    expect(js.network.bonds.bond0.parameters).toEqual({ mode: '802.3ad', 'lacp-rate': 'fast', 'mii-monitor-interval': 100, 'transmit-hash-policy': 'layer3+4' });
    expect(js.network.vlans.vlan10).toMatchObject({ id: 10, link: 'bond0' });
    expect(js.network.bridges.br0.interfaces).toEqual(['vlan10']);
    expect(js.network.bridges.br0.parameters).toEqual({ stp: false, 'forward-delay': 0 });
    expect(js.network.ethernets.eno1).toEqual({ dhcp4: false, dhcp6: false });
  });
  it('emits sections in dependency-friendly order', () => {
    const y = generateYaml(PRESETS.find((p) => p.key === 'vm-host')!.build());
    const idx = ['ethernets:', 'bonds:', 'bridges:', 'vlans:'].map((k) => y.indexOf(k));
    expect(idx.every((i) => i > 0)).toBe(true);
    expect(idx[0]).toBeLessThan(idx[1]);
  });
  it('emits bond primary and bridge priority', () => {
    const js = gen(SCENARIOS.find((s) => s.name === 'bond-active-backup-bridge-networkd')!.build());
    expect(js.network.bonds.bond0.parameters).toEqual({ mode: 'active-backup', 'mii-monitor-interval': 100, primary: 'enp1s0' });
    expect(js.network.bridges.br0.parameters).toEqual({ stp: true, 'forward-delay': 4, priority: 4096 });
  });
  it('throws (instead of guessing) on dangling references', () => {
    const cfg = PRESETS.find((p) => p.key === 'vm-host')!.build();
    cfg.devices = cfg.devices.filter((d) => d.id !== 'eno1');
    expect(errorsOf(cfg).length).toBeGreaterThan(0);
    expect(() => generateYaml(cfg)).toThrow();
  });
});

describe('Wi-Fi', () => {
  it('quotes tricky SSIDs and passwords exactly', () => {
    const cfg = SCENARIOS.find((s) => s.name === 'wifi-psk-nm')!.build();
    const js = gen(cfg);
    const aps = js.network.wifis.wlp2s0['access-points'];
    expect(Object.keys(aps)).toEqual([TEST_SSID_TRICKY]);
    expect(aps[TEST_SSID_TRICKY].auth).toEqual({ 'key-management': 'psk', password: TEST_PASSWORD_TRICKY });
  });
  it('emits sae, open, hidden, band, channel and bssid', () => {
    const js = gen(SCENARIOS.find((s) => s.name === 'wifi-multi-networkd')!.build());
    const aps = js.network.wifis.wlan0['access-points'];
    expect(aps.HomeWPA3.auth['key-management']).toBe('sae');
    expect(aps['0123']).toMatchObject({ hidden: true, band: '5GHz', channel: 36, bssid: '02:00:00:aa:bb:cc' });
    expect(aps['0123'].auth.password).toBe('f'.repeat(64));
    expect(aps.no).toEqual({ band: '2.4GHz', channel: 6 });
  });
  it('masks passwords in preview mode only', () => {
    const cfg = SCENARIOS.find((s) => s.name === 'wifi-psk-nm')!.build();
    const masked = generateYaml(cfg, { maskSecrets: true });
    expect(masked).not.toContain('pa ss');
    expect(masked).toContain(SECRET_MASK);
    expect(generateYaml(cfg)).toContain('pa ss');
  });
});

describe('YAML injection resistance', () => {
  it('keeps hostile text inside scalars', () => {
    const evil = 'x"\n  renderer: evil\n#';
    const cfg: Config = {
      ...defaultConfig(),
      devices: [newDevice('wifi', 'wlan0', { accessPoints: [newAccessPoint({ ssid: evil, security: 'psk', password: evil + '12345678' })] })],
    };
    const js = gen(cfg);
    expect(js.network.renderer).toBe('networkd');
    expect(Object.keys(js.network.wifis.wlan0['access-points'])).toEqual([evil]);
    // the validator still rejects control characters in SSIDs and non-printable passphrases
    expect(errorsOf(cfg).length).toBeGreaterThan(0);
  });
});

describe('routes', () => {
  it('never emits deprecated gateway4/gateway6', () => {
    for (const s of SCENARIOS) expect(generateYaml(s.build())).not.toMatch(/gateway[46]/);
  });
  it('writes route metric and table as integers', () => {
    const d = newDevice('ethernet', 'eth0', { dhcp4: false, addresses: ['10.0.0.2/24'], routes: [newRoute({ to: '10.1.0.0/16', via: '10.0.0.1', metric: '25', table: '10' })] });
    const r = gen({ ...defaultConfig(), devices: [d] }).network.ethernets.eth0.routes[0];
    expect(r).toEqual({ to: '10.1.0.0/16', via: '10.0.0.1', metric: 25, table: 10 });
  });
});
