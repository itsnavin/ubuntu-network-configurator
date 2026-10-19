import { describe, expect, it } from 'vitest';
import { defaultConfig, emptyOverrides, newAccessPoint, newDevice, newRoute, type Config, type Device } from '../src/lib/model';
import { validate, validatePassphrase, validateSsid } from '../src/lib/validate';

const cfgOf = (devices: Device[], extra: Partial<Config> = {}): Config => ({ ...defaultConfig(), devices, ...extra });
const errs = (cfg: Config) => validate(cfg).filter((i) => i.level === 'error');
const hasErr = (cfg: Config, field: RegExp, msg?: RegExp) => errs(cfg).some((e) => field.test(e.field) && (!msg || msg.test(e.message)));
const hasLevel = (cfg: Config, level: string, msg: RegExp) => validate(cfg).some((e) => e.level === level && msg.test(e.message));

describe('global', () => {
  it.each(['50-cloud-init.yaml', '00-installer-config.yaml', '01-network-manager-all.yaml', '90-NM-abc.yaml', 'a/b.yaml', '../x.yaml', 'x.yml', 'has space.yaml', ''])('rejects file name %j', (f) => {
    expect(hasErr(cfgOf([newDevice('ethernet', 'eth0')], { fileName: f }), /^fileName$/)).toBe(true);
  });
  it('warns when the file sorts before cloud-init', () => {
    expect(validate(cfgOf([newDevice('ethernet', 'eth0')], { fileName: '10-x.yaml' })).some((i) => i.field === 'fileName' && i.level === 'warning')).toBe(true);
  });
  it('requires at least one device', () => {
    expect(hasErr(cfgOf([]), /^devices$/)).toBe(true);
  });
});

describe('identifiers', () => {
  it.each(['', 'a'.repeat(16), 'eth 0', '-eth0', 'eth0/1', 'é0', ' eth0'])('rejects ID %j', (id) => {
    const d = newDevice('ethernet', id);
    expect(hasErr(cfgOf([d]), /\.id$/)).toBe(true);
  });
  it('rejects duplicate IDs and set-name collisions', () => {
    expect(hasErr(cfgOf([newDevice('ethernet', 'eth0'), newDevice('ethernet', 'eth0')]), /\.id$/, /more than once/)).toBe(true);
    const a = newDevice('ethernet', 'eth0');
    const b = newDevice('ethernet', 'nic', { matchMac: '52:54:00:00:00:01', setName: 'eth0' });
    expect(errs(cfgOf([a, b])).length).toBeGreaterThan(0);
  });
  it('requires a match for set-name and validates MACs', () => {
    expect(hasErr(cfgOf([newDevice('ethernet', 'eth0', { setName: 'lan0' })]), /setName$/, /requires a match/)).toBe(true);
    expect(hasErr(cfgOf([newDevice('ethernet', 'eth0', { matchMac: '52-54-00-00-00-01' })]), /matchMac$/)).toBe(true);
    expect(hasErr(cfgOf([newDevice('ethernet', 'eth0', { matchMac: '01:00:5e:00:00:01' })]), /matchMac$/, /multicast/)).toBe(true);
    expect(hasErr(cfgOf([newDevice('ethernet', 'eth0', { macaddress: '03:00:00:00:00:01' })]), /macaddress$/)).toBe(true);
  });
  it('validates MTU range', () => {
    expect(hasErr(cfgOf([newDevice('ethernet', 'eth0', { mtu: '67' })]), /mtu$/)).toBe(true);
    expect(hasErr(cfgOf([newDevice('ethernet', 'eth0', { mtu: '1500.5' })]), /mtu$/)).toBe(true);
    expect(hasErr(cfgOf([newDevice('ethernet', 'eth0', { mtu: '01500' })]), /mtu$/)).toBe(true);
    expect(hasErr(cfgOf([newDevice('ethernet', 'eth0', { mtu: '1500', matchMac: '52:54:00:00:00:01' })]), /mtu$/)).toBe(false);
  });
});

describe('addresses', () => {
  const addr = (a: string, extra: Partial<Device> = {}) => cfgOf([newDevice('ethernet', 'eth0', { dhcp4: false, addresses: [a], ...extra })]);
  it.each(['192.168.1.10', '192.168.01.10/24', '192.168.1.10/33', '192.168.1.0/24', '192.168.1.255/24', '127.0.0.1/8', '224.0.0.1/24', '0.0.0.0/0', '::1/128', 'ff02::1/64', '2001:db8::1/129', 'fe80::1%eth0/64', 'not-an-ip/24'])(
    'rejects %j',
    (a) => {
      expect(hasErr(addr(a), /addresses\.0$/)).toBe(true);
    },
  );
  it.each(['192.168.1.10/24', '10.0.0.1/8', '203.0.113.5/32', '192.168.1.0/31', '2001:db8::10/64', 'fd00::1/128'])('accepts %j', (a) => {
    expect(hasErr(addr(a), /addresses\.0$/)).toBe(false);
  });
  it('detects duplicates on one interface and across interfaces', () => {
    expect(hasErr(cfgOf([newDevice('ethernet', 'eth0', { addresses: ['10.0.0.1/24', '10.0.0.1/16'] })]), /addresses\.1$/, /twice/)).toBe(true);
    expect(
      hasErr(cfgOf([newDevice('ethernet', 'eth0', { addresses: ['10.0.0.1/24'] }), newDevice('ethernet', 'eth1', { addresses: ['10.0.0.1/24'] })]), /addresses\.0$/, /also configured/),
    ).toBe(true);
  });
  it('validates DNS servers and search domains', () => {
    const d = (ns: string[], search: string[] = []) => cfgOf([newDevice('ethernet', 'eth0', { nameservers: ns, search })]);
    expect(hasErr(d(['1.1.1.1:53']), /nameservers\.0$/)).toBe(true);
    expect(hasErr(d(['8.8.8.8/32']), /nameservers\.0$/)).toBe(true);
    expect(hasErr(d(['fe80::1']), /nameservers\.0$/, /Link-local/)).toBe(true);
    expect(hasErr(d(['008.8.8.8']), /nameservers\.0$/)).toBe(true);
    expect(hasErr(d(['2606:4700:4700::1111']), /nameservers/)).toBe(false);
    expect(hasErr(d([], ['exa mple.com']), /search\.0$/)).toBe(true);
    expect(hasErr(d([], ['-bad.com']), /search\.0$/)).toBe(true);
    expect(hasErr(d([], ['good.example.com']), /search/)).toBe(false);
  });
});

describe('routes and gateways', () => {
  const dev = (routes: ReturnType<typeof newRoute>[], extra: Partial<Device> = {}) =>
    cfgOf([newDevice('ethernet', 'eth0', { dhcp4: false, addresses: ['192.168.1.10/24', '2001:db8::10/64'], routes, ...extra })]);
  it('requires a reachable next hop', () => {
    expect(hasErr(dev([newRoute({ to: 'default', via: '10.0.0.1' })]), /via$/, /not inside any subnet/)).toBe(true);
    expect(hasErr(dev([newRoute({ to: 'default', via: '192.168.1.1' })]), /routes/)).toBe(false);
  });
  it('allows an explicit on-link exception with a warning', () => {
    const c = dev([newRoute({ to: 'default', via: '10.0.0.1', onLink: true })]);
    expect(hasErr(c, /routes/)).toBe(false);
    expect(hasLevel(c, 'warning', /on-link tells the kernel/)).toBe(true);
  });
  it('accepts IPv6 link-local next hops (scoped to the interface)', () => {
    const c = dev([newRoute({ to: 'default', via: 'fe80::1' })]);
    expect(hasErr(c, /routes/)).toBe(false);
    expect(hasLevel(c, 'info', /Link-local next hop/)).toBe(true);
  });
  it('rejects malformed routes', () => {
    expect(hasErr(dev([newRoute({ to: 'default', via: '' })]), /via$/)).toBe(true);
    expect(hasErr(dev([newRoute({ to: '10.20.0.0/16', via: '' })]), /via$/)).toBe(true);
    expect(hasErr(dev([newRoute({ to: '10.20.0.1/16', via: '192.168.1.1' })]), /to$/, /host bits/)).toBe(true);
    expect(hasErr(dev([newRoute({ to: '10.20.0.0/16', via: '2001:db8::1' })]), /via$/, /same IP family/)).toBe(true);
    expect(hasErr(dev([newRoute({ to: 'default', via: '192.168.1.10' })]), /via$/, /own address/)).toBe(true);
    expect(hasErr(dev([newRoute({ to: 'default', via: '192.168.1.1', metric: '-1' })]), /metric$/)).toBe(true);
    expect(hasErr(dev([newRoute({ to: 'default', via: '192.168.1.1', metric: '4294967296' })]), /metric$/)).toBe(true);
    expect(hasErr(dev([newRoute({ to: 'default', via: '192.168.1.1', table: '0' })]), /table$/)).toBe(true);
    expect(hasErr(dev([newRoute({ to: 'default', via: '192.168.1.1', table: '255' })]), /table$/)).toBe(true);
  });
  it('rejects routes for a family the interface does not have', () => {
    const c = cfgOf([newDevice('ethernet', 'eth0', { dhcp4: false, acceptRa: 'false', addresses: ['192.168.1.10/24'], routes: [newRoute({ to: 'default', via: 'fe80::1' })] })]);
    expect(hasErr(c, /to$/, /no IPv6/)).toBe(true);
  });
  it('flags ambiguous duplicate default routes across interfaces', () => {
    const a = newDevice('ethernet', 'eth0', { dhcp4: false, addresses: ['192.168.1.10/24'], routes: [newRoute({ to: 'default', via: '192.168.1.1' })] });
    const b = newDevice('ethernet', 'eth1', { dhcp4: false, addresses: ['192.168.2.10/24'], routes: [newRoute({ to: 'default', via: '192.168.2.1' })] });
    expect(errs(cfgOf([a, b])).length).toBeGreaterThan(0);
    b.routes[0].metric = '200';
    expect(errs(cfgOf([a, b]))).toEqual([]);
  });
  it('warns about a static default route next to DHCP', () => {
    const c = cfgOf([newDevice('ethernet', 'eth0', { dhcp4: true, addresses: ['192.168.1.10/24'], routes: [newRoute({ to: 'default', via: '192.168.1.1' })] })]);
    expect(hasLevel(c, 'warning', /DHCPv4/)).toBe(true);
  });
});

describe('DHCP overrides and renderer restrictions', () => {
  it('networkd requires identical dhcp4/dhcp6 overrides', () => {
    const d = newDevice('ethernet', 'eth0', { dhcp4: true, dhcp6: true, dhcp4Overrides: { ...emptyOverrides(), routeMetric: '100' } });
    expect(hasErr(cfgOf([d]), /dhcp6Overrides$/, /same keys/)).toBe(true);
    d.dhcp6Overrides = { ...d.dhcp4Overrides };
    expect(hasErr(cfgOf([d]), /Overrides/)).toBe(false);
  });
  it('NetworkManager only honours use-routes and route-metric', () => {
    const d = newDevice('ethernet', 'eth0', { dhcp4: true, dhcp4Overrides: { ...emptyOverrides(), useDns: 'false' } });
    expect(hasErr(cfgOf([d], { renderer: 'NetworkManager' }), /dhcp4Overrides$/, /networkd/)).toBe(true);
    expect(hasErr(cfgOf([d]), /dhcp4Overrides/)).toBe(false);
    d.dhcp4Overrides = { ...emptyOverrides(), useRoutes: 'false', routeMetric: '200' };
    expect(hasErr(cfgOf([d], { renderer: 'NetworkManager' }), /Overrides/)).toBe(false);
  });
  it('NetworkManager does not require identical overrides', () => {
    const d = newDevice('ethernet', 'eth0', { dhcp4: true, dhcp6: true, dhcp4Overrides: { ...emptyOverrides(), routeMetric: '100' } });
    expect(hasErr(cfgOf([d], { renderer: 'NetworkManager' }), /Overrides/)).toBe(false);
  });
  it('rejects overrides for a disabled DHCP family', () => {
    const d = newDevice('ethernet', 'eth0', { dhcp4: false, addresses: ['10.0.0.2/24'], dhcp4Overrides: { ...emptyOverrides(), useDns: 'false' } });
    expect(hasErr(cfgOf([d]), /dhcp4Overrides$/, /DHCPv4 is off/)).toBe(true);
  });
  it('blocks networkd-only keys under NetworkManager', () => {
    const nm = { renderer: 'NetworkManager' as const };
    expect(hasErr(cfgOf([newDevice('ethernet', 'eth0', { optional: true })], nm), /optional$/)).toBe(true);
    expect(hasErr(cfgOf([newDevice('ethernet', 'eth0', { dhcpIdentifier: 'mac' })], nm), /dhcpIdentifier$/)).toBe(true);
    expect(hasErr(cfgOf([newDevice('ethernet', 'eth0', { optional: true, dhcpIdentifier: 'mac' })]), /optional|dhcpIdentifier/)).toBe(false);
  });
  it('validates override values', () => {
    const d = newDevice('ethernet', 'eth0', { dhcp4: true, dhcp4Overrides: { ...emptyOverrides(), routeMetric: 'abc', hostname: 'bad host' } });
    expect(hasErr(cfgOf([d]), /routeMetric$/)).toBe(true);
    expect(hasErr(cfgOf([d]), /hostname$/)).toBe(true);
  });
});

describe('Wi-Fi validation', () => {
  it('validates SSIDs by UTF-8 byte length', () => {
    expect(validateSsid('')).not.toBeNull();
    expect(validateSsid('a'.repeat(32))).toBeNull();
    expect(validateSsid('a'.repeat(33))).not.toBeNull();
    expect(validateSsid('é'.repeat(16))).toBeNull();
    expect(validateSsid('é'.repeat(17))).not.toBeNull();
    expect(validateSsid('🚀'.repeat(8))).toBeNull();
    expect(validateSsid('🚀'.repeat(9))).not.toBeNull();
    expect(validateSsid('bad\nssid')).not.toBeNull();
  });
  it('validates passphrases', () => {
    expect(validatePassphrase('1234567')).not.toBeNull();
    expect(validatePassphrase('12345678')).toBeNull();
    expect(validatePassphrase('a'.repeat(63))).toBeNull();
    expect(validatePassphrase('a'.repeat(64))).toBeNull();
    expect(validatePassphrase('z'.repeat(64))).not.toBeNull();
    expect(validatePassphrase('a'.repeat(65))).not.toBeNull();
    expect(validatePassphrase('pässwörd123')).not.toBeNull();
    expect(validatePassphrase('pass\tword1')).not.toBeNull();
  });
  it('checks security/password consistency and channel rules', () => {
    const w = (ap: Parameters<typeof newAccessPoint>[0]) => cfgOf([newDevice('wifi', 'wlan0', { accessPoints: [newAccessPoint(ap)] })]);
    expect(hasErr(w({ ssid: 'x', security: 'psk', password: '' }), /password$/)).toBe(true);
    expect(hasErr(w({ ssid: 'x', security: 'open', password: 'secret123' }), /password$/)).toBe(true);
    expect(hasErr(w({ ssid: 'x', security: 'open', channel: '6' }), /channel$/, /band/)).toBe(true);
    expect(hasErr(w({ ssid: 'x', security: 'open', band: '2.4GHz', channel: '36' }), /channel$/)).toBe(true);
    expect(hasErr(w({ ssid: 'x', security: 'open', band: '5GHz', channel: '36' }), /channel$/)).toBe(false);
    expect(hasErr(w({ ssid: 'x', security: 'open', bssid: 'zz:zz' }), /bssid$/)).toBe(true);
    expect(hasErr(cfgOf([newDevice('wifi', 'wlan0', { accessPoints: [] })]), /accessPoints$/)).toBe(true);
    const dup = cfgOf([newDevice('wifi', 'wlan0', { accessPoints: [newAccessPoint({ ssid: 'a', security: 'open' }), newAccessPoint({ ssid: 'a', security: 'open' })] })]);
    expect(hasErr(dup, /ssid$/, /twice/)).toBe(true);
  });
});

describe('graph topology', () => {
  it('rejects members with IP configuration', () => {
    const a = newDevice('ethernet', 'eth0', { dhcp4: true });
    const br = newDevice('bridge', 'br0', { members: [a.uid], dhcp4: true });
    expect(hasErr(cfgOf([a, br]), /dhcp4$/, /member of br0/)).toBe(true);
  });
  it('rejects a device owned by two bridges/bonds', () => {
    const a = newDevice('ethernet', 'eth0', { dhcp4: false });
    const b1 = newDevice('bridge', 'br0', { members: [a.uid] });
    const b2 = newDevice('bond', 'bond0', { members: [a.uid] });
    expect(hasErr(cfgOf([a, b1, b2]), /\.id$/, /only one bridge or bond/)).toBe(true);
  });
  it('enforces member kinds', () => {
    const w = newDevice('wifi', 'wlan0', { dhcp4: false, accessPoints: [newAccessPoint({ ssid: 'x', security: 'open' })] });
    const v = newDevice('vlan', 'vlan10', { vlanId: '10' });
    const bond = newDevice('bond', 'bond0', { members: [w.uid, v.uid] });
    const c = errs(cfgOf([w, v, bond]));
    expect(c.some((e) => /Bond members must be Ethernet/.test(e.message))).toBe(true);
  });
  it('rejects missing references', () => {
    const br = newDevice('bridge', 'br0', { members: ['missing-uid'] });
    const v = newDevice('vlan', 'vlan10', { vlanId: '10', vlanLink: 'missing-uid' });
    const c = cfgOf([br, v]);
    expect(hasErr(c, /members\.0$/, /no longer exists/)).toBe(true);
    expect(hasErr(c, /vlanLink$/, /no longer exists/)).toBe(true);
  });
  it('rejects cycles', () => {
    const b1 = newDevice('bridge', 'br0', {});
    const b2 = newDevice('bond', 'bond0', {});
    const v = newDevice('vlan', 'vlan10', { vlanId: '10', vlanLink: b1.uid });
    b1.members = [v.uid];
    b2.members = [];
    expect(hasErr(cfgOf([b1, b2, v]), /members$/, /Circular/)).toBe(true);
  });
  it('rejects self-membership and self-parent', () => {
    const br = newDevice('bridge', 'br0', {});
    br.members = [br.uid];
    expect(hasErr(cfgOf([br]), /members\.0$/)).toBe(true);
    const v = newDevice('vlan', 'vlan10', { vlanId: '10' });
    v.vlanLink = v.uid;
    expect(hasErr(cfgOf([v]), /vlanLink$/)).toBe(true);
  });
  it('validates VLAN ids and parents', () => {
    const p = newDevice('ethernet', 'eth0');
    for (const id of ['0', '4095', 'abc', '', '010']) {
      expect(hasErr(cfgOf([p, newDevice('vlan', 'v', { vlanId: id, vlanLink: p.uid })]), /vlanId$/)).toBe(true);
    }
    const w = newDevice('wifi', 'wlan0', { accessPoints: [newAccessPoint({ ssid: 'x', security: 'open' })] });
    expect(hasErr(cfgOf([w, newDevice('vlan', 'v', { vlanId: '5', vlanLink: w.uid })]), /vlanLink$/, /parent must be/)).toBe(true);
    const a = newDevice('ethernet', 'eth1', { dhcp4: false });
    const bond = newDevice('bond', 'bond0', { members: [a.uid] });
    expect(hasErr(cfgOf([a, bond, newDevice('vlan', 'v', { vlanId: '5', vlanLink: a.uid })]), /vlanLink$/, /bond member/)).toBe(true);
  });
  it('validates bond mode-specific parameters', () => {
    const a = newDevice('ethernet', 'eth0', { dhcp4: false });
    const b = newDevice('ethernet', 'eth1', { dhcp4: false });
    const bond = (p: Partial<Device>) => cfgOf([a, b, newDevice('bond', 'bond0', { members: [a.uid, b.uid], ...p })]);
    expect(hasErr(bond({ bondMode: 'active-backup', bondLacpRate: 'fast' }), /bondLacpRate$/)).toBe(true);
    expect(hasErr(bond({ bondMode: 'active-backup', bondTransmitHashPolicy: 'layer3+4' }), /bondTransmitHashPolicy$/)).toBe(true);
    expect(hasErr(bond({ bondMode: '802.3ad', bondPrimary: a.uid }), /bondPrimary$/)).toBe(true);
    expect(hasErr(bond({ bondMode: 'active-backup', bondPrimary: 'x' }), /bondPrimary$/)).toBe(true);
    expect(hasErr(bond({ bondMode: 'active-backup', bondMiiMonitorInterval: '1.5' }), /bondMiiMonitorInterval$/)).toBe(true);
  });
  it('validates bridge parameters', () => {
    expect(hasErr(cfgOf([newDevice('bridge', 'br0', { bridgePriority: '65536' })]), /bridgePriority$/)).toBe(true);
    expect(hasErr(cfgOf([newDevice('bridge', 'br0', { bridgeForwardDelay: '31' })]), /bridgeForwardDelay$/)).toBe(true);
  });
});
