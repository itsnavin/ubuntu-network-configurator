import { defaultConfig, emptyOverrides, newAccessPoint, newDevice, newRoute, type Config } from './model';

export interface Preset {
  key: string;
  title: string;
  description: string;
  build: () => Config;
}

// Interface names in presets are EXAMPLES. The UI tells users to replace them with the
// names shown by `ip -br link` on their own machine.
export const PRESETS: Preset[] = [
  {
    key: 'dhcp',
    title: 'One wired interface with DHCP',
    description: 'Typical home/office machine: address, gateway and DNS from the DHCP server.',
    build: () => ({ ...defaultConfig(), devices: [newDevice('ethernet', 'enp3s0', { dhcp4: true })] }),
  },
  {
    key: 'static-ipv4',
    title: 'Static IPv4 server',
    description: 'Fixed address, default gateway and DNS servers on one wired interface.',
    build: () => ({
      ...defaultConfig(),
      devices: [
        newDevice('ethernet', 'enp3s0', {
          dhcp4: false,
          addresses: ['192.168.1.50/24'],
          routes: [newRoute({ to: 'default', via: '192.168.1.1' })],
          nameservers: ['192.168.1.1', '1.1.1.1'],
          search: ['example.lan'],
        }),
      ],
    }),
  },
  {
    key: 'dual-stack',
    title: 'Static dual-stack (IPv4 + IPv6)',
    description: 'Static IPv4 and IPv6 with one default route per family; router advertisements disabled.',
    build: () => ({
      ...defaultConfig(),
      devices: [
        newDevice('ethernet', 'enp3s0', {
          dhcp4: false,
          acceptRa: 'false',
          addresses: ['203.0.113.10/24', '2001:db8:10::10/64'],
          routes: [newRoute({ to: 'default', via: '203.0.113.1' }), newRoute({ to: 'default', via: '2001:db8:10::1' })],
          nameservers: ['2001:db8:10::53', '203.0.113.53'],
        }),
      ],
    }),
  },
  {
    key: 'wifi',
    title: 'Laptop Wi-Fi (NetworkManager)',
    description: 'WPA2-Personal network with DHCP, rendered by NetworkManager like Ubuntu Desktop.',
    build: () => ({
      ...defaultConfig(),
      renderer: 'NetworkManager',
      devices: [newDevice('wifi', 'wlp2s0', { dhcp4: true, accessPoints: [newAccessPoint({ ssid: 'HomeNetwork', security: 'psk' })] })],
    }),
  },
  {
    key: 'two-nics',
    title: 'Two DHCP uplinks with route metrics',
    description: 'Prefer enp3s0; keep enp4s0 as backup by giving its DHCP routes a higher metric.',
    build: () => ({
      ...defaultConfig(),
      devices: [
        newDevice('ethernet', 'enp3s0', { dhcp4: true, dhcp4Overrides: { ...emptyOverrides(), routeMetric: '100' } }),
        newDevice('ethernet', 'enp4s0', { dhcp4: true, dhcp4Overrides: { ...emptyOverrides(), routeMetric: '200', useDns: 'false' } }),
      ],
    }),
  },
  {
    key: 'vm-host',
    title: 'VM host: bond + VLAN + bridge',
    description: 'Two NICs in an LACP bond, VLAN 10 on the bond, and a bridge on the VLAN carrying the host address.',
    build: () => {
      const eno1 = newDevice('ethernet', 'eno1', { dhcp4: false });
      const eno2 = newDevice('ethernet', 'eno2', { dhcp4: false });
      const bond = newDevice('bond', 'bond0', {
        dhcp4: false,
        members: [eno1.uid, eno2.uid],
        bondMode: '802.3ad',
        bondLacpRate: 'fast',
        bondTransmitHashPolicy: 'layer3+4',
        bondMiiMonitorInterval: '100',
      });
      const vlan = newDevice('vlan', 'vlan10', { dhcp4: false, vlanId: '10', vlanLink: bond.uid });
      const br = newDevice('bridge', 'br0', {
        dhcp4: false,
        members: [vlan.uid],
        bridgeStp: 'false',
        bridgeForwardDelay: '0',
        addresses: ['10.10.0.5/24'],
        routes: [newRoute({ to: 'default', via: '10.10.0.1' })],
        nameservers: ['10.10.0.1'],
      });
      return { ...defaultConfig(), devices: [eno1, eno2, bond, vlan, br] };
    },
  },
];
