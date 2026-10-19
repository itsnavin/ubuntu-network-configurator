import { defaultConfig, emptyOverrides, newAccessPoint, newDevice, newRoute, type Config, type Renderer } from '../src/lib/model';
import { PRESETS } from '../src/lib/presets';

export interface Scenario {
  name: string;
  build: () => Config;
}

const withRenderer = (cfg: Config, renderer: Renderer): Config => ({ ...cfg, renderer });
const preset = (k: string) => PRESETS.find((p) => p.key === k)!.build();

// Fake credentials used only for tests. They are not real networks or passwords.
export const TEST_PASSWORD_TRICKY = `pa ss'w"ord: #x - [y] {z} \\ no`;
export const TEST_SSID_TRICKY = `Café "Guest": #1 - yes`;

/** Every scenario must validate with zero errors; each becomes fixtures/valid/<name>.yaml. */
export const SCENARIOS: Scenario[] = [
  { name: 'dhcp-networkd', build: () => preset('dhcp') },
  { name: 'dhcp-nm', build: () => withRenderer(preset('dhcp'), 'NetworkManager') },
  { name: 'static-ipv4-networkd', build: () => preset('static-ipv4') },
  { name: 'static-ipv4-nm', build: () => withRenderer(preset('static-ipv4'), 'NetworkManager') },
  { name: 'dual-stack-networkd', build: () => preset('dual-stack') },
  { name: 'dual-stack-nm', build: () => withRenderer(preset('dual-stack'), 'NetworkManager') },
  { name: 'two-uplinks-networkd', build: () => preset('two-nics') },
  { name: 'vm-host-networkd', build: () => preset('vm-host') },
  { name: 'vm-host-nm', build: () => withRenderer(preset('vm-host'), 'NetworkManager') },
  {
    name: 'wifi-psk-nm',
    build: () => ({
      ...defaultConfig(),
      renderer: 'NetworkManager',
      devices: [
        newDevice('wifi', 'wlp2s0', {
          dhcp4: true,
          accessPoints: [newAccessPoint({ ssid: TEST_SSID_TRICKY, security: 'psk', password: TEST_PASSWORD_TRICKY })],
        }),
      ],
    }),
  },
  {
    name: 'wifi-multi-networkd',
    build: () => ({
      ...defaultConfig(),
      devices: [
        newDevice('wifi', 'wlan0', {
          dhcp4: true,
          dhcp6: true,
          accessPoints: [
            newAccessPoint({ ssid: 'HomeWPA3', security: 'sae', password: 'correct horse battery staple' }),
            newAccessPoint({ ssid: '0123', security: 'psk', password: 'a'.repeat(64).replace(/a/g, 'f'), hidden: true, band: '5GHz', channel: '36', bssid: '02:00:00:aa:bb:cc' }),
            newAccessPoint({ ssid: 'no', security: 'open', band: '2.4GHz', channel: '6' }),
          ],
        }),
      ],
    }),
  },
  {
    name: 'wifi-static-nm',
    build: () => ({
      ...defaultConfig(),
      renderer: 'NetworkManager',
      devices: [
        newDevice('wifi', 'wlp2s0', {
          dhcp4: false,
          addresses: ['192.168.50.20/24'],
          routes: [newRoute({ to: 'default', via: '192.168.50.1' })],
          nameservers: ['192.168.50.1'],
          accessPoints: [newAccessPoint({ ssid: 'Lab: 5G', security: 'psk', password: '12345678' })],
        }),
      ],
    }),
  },
  {
    name: 'advanced-ethernet-networkd',
    build: () => ({
      ...defaultConfig(),
      devices: [
        newDevice('ethernet', 'lan', {
          matchMac: '52:54:00:12:34:56',
          setName: 'lan0',
          macaddress: '52:54:00:aa:bb:cc',
          mtu: '9000',
          optional: true,
          dhcp4: true,
          dhcp6: true,
          dhcpIdentifier: 'mac',
          dhcp4Overrides: { ...emptyOverrides(), useDns: 'false', useNtp: 'false', useDomains: 'route', useHostname: 'false', sendHostname: 'true', hostname: 'server-01', useMtu: 'true', useRoutes: 'true', routeMetric: '50' },
          dhcp6Overrides: { ...emptyOverrides(), useDns: 'false', useNtp: 'false', useDomains: 'route', useHostname: 'false', sendHostname: 'true', hostname: 'server-01', useMtu: 'true', useRoutes: 'true', routeMetric: '50' },
          acceptRa: 'true',
          linkLocal: 'both',
          ipv6Privacy: true,
          ipv6AddressGeneration: 'stable-privacy',
          addresses: ['10.0.0.10/24', 'fd00:10::10/64'],
          nameservers: ['10.0.0.53', 'fd00:10::53'],
          search: ['example.lan', 'no'],
          routes: [
            newRoute({ to: '172.16.0.0/12', via: '10.0.0.254', metric: '0' }),
            newRoute({ to: '192.168.200.0/24', via: '10.0.0.253', metric: '300', table: '100' }),
            newRoute({ to: 'fd00:99::/48', via: 'fe80::1' }),
          ],
        }),
      ],
    }),
  },
  {
    name: 'onlink-cloud-networkd',
    build: () => ({
      ...defaultConfig(),
      devices: [
        newDevice('ethernet', 'eth0', {
          dhcp4: false,
          addresses: ['203.0.113.77/32', '2001:db8:77::2/128'],
          routes: [newRoute({ to: 'default', via: '172.31.1.1', onLink: true }), newRoute({ to: 'default', via: 'fe80::1' })],
          nameservers: ['1.1.1.1', '2606:4700:4700::1111'],
        }),
      ],
    }),
  },
  {
    name: 'nm-overrides-match-name',
    build: () => ({
      ...defaultConfig(),
      renderer: 'NetworkManager',
      devices: [
        newDevice('ethernet', 'uplink', {
          matchName: 'enp*',
          dhcp4: true,
          dhcp6: true,
          dhcp4Overrides: { ...emptyOverrides(), useRoutes: 'false', routeMetric: '700' },
          dhcp6Overrides: { ...emptyOverrides(), routeMetric: '800' },
          routes: [newRoute({ to: '10.99.0.0/16', via: '192.168.1.1', metric: '10', table: '200' })],
        }),
      ],
    }),
  },
  {
    name: 'bond-active-backup-bridge-networkd',
    build: () => {
      const a = newDevice('ethernet', 'enp1s0', { dhcp4: false });
      const b = newDevice('ethernet', 'enp2s0', { dhcp4: false });
      const bond = newDevice('bond', 'bond0', { dhcp4: false, members: [a.uid, b.uid], bondMode: 'active-backup', bondPrimary: a.uid, bondMiiMonitorInterval: '100' });
      const br = newDevice('bridge', 'br0', { dhcp4: true, members: [bond.uid], bridgeStp: 'true', bridgeForwardDelay: '4', bridgePriority: '4096' });
      return { ...defaultConfig(), devices: [a, b, bond, br] };
    },
  },
  {
    name: 'vlans-on-ethernet-nm',
    build: () => {
      const p = newDevice('ethernet', 'enp3s0', { dhcp4: true });
      const v20 = newDevice('vlan', 'vlan20', { dhcp4: false, vlanId: '20', vlanLink: p.uid, addresses: ['10.20.0.5/24'] });
      const v30 = newDevice('vlan', 'enp3s0.30', { dhcp4: true, vlanId: '30', vlanLink: p.uid });
      return { ...defaultConfig(), renderer: 'NetworkManager', devices: [p, v20, v30] };
    },
  },
  {
    name: 'bond-balance-xor-networkd',
    build: () => {
      const a = newDevice('ethernet', 'eno1', { dhcp4: false });
      const b = newDevice('ethernet', 'eno2', { dhcp4: false });
      const bond = newDevice('bond', 'bond1', {
        dhcp4: false,
        members: [a.uid, b.uid],
        bondMode: 'balance-xor',
        bondTransmitHashPolicy: 'layer2+3',
        bondMiiMonitorInterval: '200',
        addresses: ['192.0.2.10/24'],
        routes: [newRoute({ to: 'default', via: '192.0.2.1', metric: '100' })],
      });
      return { ...defaultConfig(), devices: [a, b, bond] };
    },
  },
];
