export type Renderer = 'networkd' | 'NetworkManager';
export type Kind = 'ethernet' | 'wifi' | 'bridge' | 'bond' | 'vlan';
export type Tri = 'default' | 'true' | 'false';
export type UbuntuTarget = '22.04' | '24.04' | '26.04';

export interface Route {
  uid: string;
  /** "default" or CIDR / bare address. */
  to: string;
  via: string;
  metric: string;
  table: string;
  onLink: boolean;
}

export interface DhcpOverrides {
  useDns: Tri;
  useNtp: Tri;
  useDomains: 'default' | 'true' | 'false' | 'route';
  useHostname: Tri;
  sendHostname: Tri;
  useMtu: Tri;
  useRoutes: Tri;
  routeMetric: string;
  hostname: string;
}

export type WifiSecurity = 'open' | 'psk' | 'sae';

export interface AccessPoint {
  uid: string;
  ssid: string;
  security: WifiSecurity;
  /** Kept only in memory. Never persisted, logged or transmitted. */
  password: string;
  hidden: boolean;
  band: 'any' | '2.4GHz' | '5GHz';
  channel: string;
  bssid: string;
}

export type BondMode =
  | 'balance-rr'
  | 'active-backup'
  | 'balance-xor'
  | 'broadcast'
  | '802.3ad'
  | 'balance-tlb'
  | 'balance-alb';

export const BOND_MODES: BondMode[] = [
  'active-backup',
  '802.3ad',
  'balance-rr',
  'balance-xor',
  'broadcast',
  'balance-tlb',
  'balance-alb',
];

export type HashPolicy = 'default' | 'layer2' | 'layer3+4' | 'layer2+3' | 'encap2+3' | 'encap3+4';
export const HASH_POLICIES: HashPolicy[] = ['default', 'layer2', 'layer2+3', 'layer3+4', 'encap2+3', 'encap3+4'];

export type LinkLocal = 'default' | 'ipv6' | 'ipv4' | 'both' | 'none';

export interface Device {
  uid: string;
  kind: Kind;
  /** Netplan configuration ID. Interface name for unmatched physical and all virtual devices. */
  id: string;
  matchMac: string;
  matchName: string;
  setName: string;
  macaddress: string;
  dhcp4: boolean;
  dhcp6: boolean;
  addresses: string[];
  acceptRa: Tri;
  linkLocal: LinkLocal;
  ipv6Privacy: boolean;
  ipv6AddressGeneration: 'default' | 'eui64' | 'stable-privacy';
  nameservers: string[];
  search: string[];
  routes: Route[];
  dhcp4Overrides: DhcpOverrides;
  dhcp6Overrides: DhcpOverrides;
  dhcpIdentifier: 'default' | 'mac' | 'duid';
  mtu: string;
  optional: boolean;
  accessPoints: AccessPoint[];
  /** Member device uids (bridges and bonds). */
  members: string[];
  bridgeStp: Tri;
  bridgeForwardDelay: string;
  bridgePriority: string;
  bondMode: BondMode;
  bondLacpRate: 'default' | 'slow' | 'fast';
  bondMiiMonitorInterval: string;
  bondTransmitHashPolicy: HashPolicy;
  /** Uid of the preferred member. */
  bondPrimary: string;
  vlanId: string;
  /** Uid of the parent device. */
  vlanLink: string;
}

export interface Config {
  ubuntu: UbuntuTarget;
  renderer: Renderer;
  fileName: string;
  devices: Device[];
}

let counter = 0;
export function newUid(prefix = 'u'): string {
  counter += 1;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${counter}-${rnd}`;
}

export function emptyOverrides(): DhcpOverrides {
  return {
    useDns: 'default',
    useNtp: 'default',
    useDomains: 'default',
    useHostname: 'default',
    sendHostname: 'default',
    useMtu: 'default',
    useRoutes: 'default',
    routeMetric: '',
    hostname: '',
  };
}

export function newRoute(partial: Partial<Route> = {}): Route {
  return { uid: newUid('r'), to: 'default', via: '', metric: '', table: '', onLink: false, ...partial };
}

export function newAccessPoint(partial: Partial<AccessPoint> = {}): AccessPoint {
  return {
    uid: newUid('ap'),
    ssid: '',
    security: 'psk',
    password: '',
    hidden: false,
    band: 'any',
    channel: '',
    bssid: '',
    ...partial,
  };
}

export function newDevice(kind: Kind, id: string, partial: Partial<Device> = {}): Device {
  return {
    uid: newUid('d'),
    kind,
    id,
    matchMac: '',
    matchName: '',
    setName: '',
    macaddress: '',
    dhcp4: kind === 'ethernet' || kind === 'wifi',
    dhcp6: false,
    addresses: [],
    acceptRa: 'default',
    linkLocal: 'default',
    ipv6Privacy: false,
    ipv6AddressGeneration: 'default',
    nameservers: [],
    search: [],
    routes: [],
    dhcp4Overrides: emptyOverrides(),
    dhcp6Overrides: emptyOverrides(),
    dhcpIdentifier: 'default',
    mtu: '',
    optional: false,
    accessPoints: kind === 'wifi' ? [newAccessPoint()] : [],
    members: [],
    bridgeStp: 'default',
    bridgeForwardDelay: '',
    bridgePriority: '',
    bondMode: 'active-backup',
    bondLacpRate: 'default',
    bondMiiMonitorInterval: '100',
    bondTransmitHashPolicy: 'default',
    bondPrimary: '',
    vlanId: '',
    vlanLink: '',
    ...partial,
  };
}

export function defaultConfig(): Config {
  return {
    ubuntu: '24.04',
    renderer: 'networkd',
    fileName: '60-netplan-configurator.yaml',
    devices: [newDevice('ethernet', 'enp3s0')],
  };
}

export const KIND_LABEL: Record<Kind, string> = {
  ethernet: 'Ethernet (wired)',
  wifi: 'Wi-Fi (client)',
  bridge: 'Bridge',
  bond: 'Bond (link aggregation)',
  vlan: 'VLAN',
};

export const KIND_SECTION: Record<Kind, string> = {
  ethernet: 'ethernets',
  wifi: 'wifis',
  bridge: 'bridges',
  bond: 'bonds',
  vlan: 'vlans',
};

export function isPhysical(k: Kind): boolean {
  return k === 'ethernet' || k === 'wifi';
}

export function hasSecrets(cfg: Config): boolean {
  return cfg.devices.some(
    (d) => d.kind === 'wifi' && d.accessPoints.some((ap) => ap.security !== 'open' && ap.password !== ''),
  );
}
