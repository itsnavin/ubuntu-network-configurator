// Compatibility data used by the UI, validation and README.
// Source: Netplan YAML reference https://netplan.readthedocs.io/en/stable/netplan-yaml/
// ("since" versions and back-end notes are copied from that page) and Ubuntu package
// versions from https://packages.ubuntu.com/search?keywords=netplan.io (checked 2026-10).

export const DOCS = {
  yaml: 'https://netplan.readthedocs.io/en/stable/netplan-yaml/',
  routing: 'https://netplan.readthedocs.io/en/stable/netplan-yaml/#routing',
  defaultRoutes: 'https://netplan.readthedocs.io/en/stable/netplan-yaml/#default-routes',
  dhcpOverrides: 'https://netplan.readthedocs.io/en/stable/netplan-yaml/#dhcp-overrides',
  wifis: 'https://netplan.readthedocs.io/en/stable/netplan-yaml/#properties-for-device-type-wifis',
  bonds: 'https://netplan.readthedocs.io/en/stable/netplan-yaml/#properties-for-device-type-bonds',
  bridges: 'https://netplan.readthedocs.io/en/stable/netplan-yaml/#properties-for-device-type-bridges',
  vlans: 'https://netplan.readthedocs.io/en/stable/netplan-yaml/#properties-for-device-type-vlans',
  structure: 'https://netplan.readthedocs.io/en/stable/structure-id/',
  generate: 'https://netplan.readthedocs.io/en/stable/netplan-generate/',
  try: 'https://netplan.readthedocs.io/en/stable/netplan-try/',
  apply: 'https://netplan.readthedocs.io/en/stable/netplan-apply/',
  get: 'https://netplan.readthedocs.io/en/stable/netplan-get/',
  status: 'https://netplan.readthedocs.io/en/stable/netplan-status/',
  examples: 'https://netplan.readthedocs.io/en/stable/examples/',
  nmAll: 'https://netplan.readthedocs.io/en/stable/nm-all/',
  everywhere: 'https://netplan.readthedocs.io/en/stable/netplan-everywhere/',
  security: 'https://netplan.readthedocs.io/en/stable/security/',
  cloudInit: 'https://cloudinit.readthedocs.io/en/latest/reference/network-config.html',
  ubuntuNetworking: 'https://documentation.ubuntu.com/server/explanation/networking/configuring-networks/',
  packages: 'https://packages.ubuntu.com/search?keywords=netplan.io&searchon=names&exact=1&suite=all&section=all',
};

export interface UbuntuRelease {
  version: '22.04' | '24.04' | '26.04';
  codename: string;
  netplanRelease: string;
  netplanUpdates: string;
}

/** Netplan package versions per supported Ubuntu LTS (packages.ubuntu.com). */
export const UBUNTU_RELEASES: UbuntuRelease[] = [
  { version: '22.04', codename: 'jammy', netplanRelease: '0.104', netplanUpdates: '0.107.1 (jammy-updates)' },
  { version: '24.04', codename: 'noble', netplanRelease: '1.0', netplanUpdates: '1.1.2 (noble-updates)' },
  { version: '26.04', codename: 'resolute', netplanRelease: '1.2', netplanUpdates: '1.2 (resolute-updates)' },
];

/** Oldest Netplan version this app targets. Every emitted key is documented as available at or before it. */
export const MIN_NETPLAN = '0.104';

export type Support = 'yes' | 'no' | 'partial';

export interface CompatRow {
  key: string;
  area: string;
  networkd: Support;
  nm: Support;
  since: string;
  note: string;
}

export const COMPAT: CompatRow[] = [
  { key: 'dhcp4 / dhcp6', area: 'Addressing', networkd: 'yes', nm: 'yes', since: '≤0.104', note: 'DHCPv6 covers stateful and stateless DHCPv6. SLAAC needs Router Advertisements (accept-ra).' },
  { key: 'addresses (CIDR)', area: 'Addressing', networkd: 'yes', nm: 'yes', since: '≤0.104', note: 'Added in addition to DHCP/RA addresses. lifetime/label sub-options are networkd only and not offered here.' },
  { key: 'routes: to/via/metric', area: 'Routing', networkd: 'yes', nm: 'yes', since: '≤0.104', note: 'Default routes use "to: default". Deprecated gateway4/gateway6 are never emitted.' },
  { key: 'routes: on-link', area: 'Routing', networkd: 'yes', nm: 'partial', since: '≤0.104', note: 'NetworkManager ≥1.12 (IPv4) and ≥1.18 (IPv6).' },
  { key: 'routes: table', area: 'Routing', networkd: 'yes', nm: 'partial', since: '≤0.104', note: 'NetworkManager ≥1.10. Without routing-policy rules, routes in other tables are not used for normal traffic.' },
  { key: 'nameservers: addresses/search', area: 'DNS', networkd: 'yes', nm: 'yes', since: '≤0.104', note: 'Per-interface DNS; with systemd-resolved DNS is link-scoped.' },
  { key: 'dhcp4/6-overrides: use-routes, route-metric', area: 'DHCP overrides', networkd: 'yes', nm: 'yes', since: '≤0.104', note: 'networkd requires identical dhcp4/dhcp6 overrides when both DHCP families are enabled.' },
  { key: 'dhcp4/6-overrides: use-dns, use-ntp, use-hostname, send-hostname, use-mtu, hostname', area: 'DHCP overrides', networkd: 'yes', nm: 'no', since: '≤0.104', note: 'Documented as only having an effect on networkd. This app blocks them with NetworkManager instead of emitting ignored keys.' },
  { key: 'dhcp4/6-overrides: use-domains', area: 'DHCP overrides', networkd: 'yes', nm: 'no', since: '0.98', note: 'true, false or route. networkd only.' },
  { key: 'dhcp-identifier', area: 'DHCP', networkd: 'yes', nm: 'no', since: '≤0.104', note: 'networkd only: mac or duid.' },
  { key: 'accept-ra', area: 'IPv6', networkd: 'yes', nm: 'yes', since: '≤0.104', note: 'Unset = kernel default.' },
  { key: 'link-local', area: 'IPv6/IPv4', networkd: 'yes', nm: 'partial', since: '≤0.104', note: 'On NetworkManager, enabling link-local has no effect if DHCP is also enabled.' },
  { key: 'ipv6-privacy', area: 'IPv6', networkd: 'yes', nm: 'yes', since: '≤0.104', note: 'RFC 4941 temporary addresses.' },
  { key: 'ipv6-address-generation', area: 'IPv6', networkd: 'yes', nm: 'yes', since: '0.99', note: 'eui64 or stable-privacy.' },
  { key: 'match: macaddress / name', area: 'Physical', networkd: 'yes', nm: 'partial', since: '≤0.104', note: 'NetworkManager supports name matching as of v1.14. Name globs are allowed.' },
  { key: 'set-name', area: 'Physical', networkd: 'yes', nm: 'partial', since: '≤0.104', note: 'Requires match. Renaming is performed via udev; verify behaviour with your renderer.' },
  { key: 'macaddress (set)', area: 'Physical', networkd: 'yes', nm: 'yes', since: '≤0.104', note: 'Match by MAC when setting a MAC with networkd (udev rename interaction).' },
  { key: 'mtu', area: 'Physical/virtual', networkd: 'yes', nm: 'yes', since: '≤0.104', note: 'Bytes. Match by MAC when setting MTU with networkd.' },
  { key: 'optional', area: 'Boot', networkd: 'yes', nm: 'no', since: '≤0.104', note: 'networkd only: do not wait for this link at boot.' },
  { key: 'wifis: access-points (open/psk/sae)', area: 'Wi-Fi', networkd: 'partial', nm: 'yes', since: '≤0.104', note: 'networkd needs wpa_supplicant (package wpasupplicant). Only client (infrastructure) mode is offered.' },
  { key: 'wifis: hidden', area: 'Wi-Fi', networkd: 'yes', nm: 'yes', since: '0.100', note: 'Slower scan technique.' },
  { key: 'wifis: band / channel / bssid', area: 'Wi-Fi', networkd: 'yes', nm: 'yes', since: '0.99', note: 'channel only takes effect when band is set.' },
  { key: 'bridges: interfaces, stp, forward-delay, priority', area: 'Bridge', networkd: 'yes', nm: 'yes', since: '≤0.104', note: 'Members must also be defined; member IP config is rejected.' },
  { key: 'bonds: mode, lacp-rate, mii-monitor-interval, transmit-hash-policy, primary', area: 'Bond', networkd: 'yes', nm: 'yes', since: '≤0.104', note: 'Mode-specific options are only accepted for the modes where the kernel uses them.' },
  { key: 'vlans: id, link', area: 'VLAN', networkd: 'yes', nm: 'yes', since: '≤0.104', note: 'IDs 1-4094 offered. Parent must be Ethernet, bond or bridge defined here.' },
];

export const NOT_SUPPORTED: string[] = [
  'WPA/WPA2/WPA3-Enterprise (EAP/802.1X) authentication, Wi-Fi access point (ap) and ad-hoc modes',
  'routing-policy (policy routing rules), route type/scope/from/mtu/congestion-window, advertised-mss (1.1+), ra-overrides (1.1+)',
  'Per-device renderer overrides (one global renderer is used)',
  'Tunnels, WireGuard, VRFs, veth, dummy devices, modems, SR-IOV, InfiniBand, Open vSwitch, nm-devices passthrough',
  'Offload toggles, wake-on-LAN/WLAN, LLDP, address lifetime/label, activation-mode, critical, ignore-carrier, ipv6-mtu, ipv6-address-token',
  'Bridge ageing-time/hello-time/max-age/path-cost/port-priority; bond ARP monitoring and the remaining bond tuning parameters',
  'Deprecated gateway4 / gateway6 keys (default routes are always written as routes with to: default)',
  'Running a DHCP server, NAT, IP forwarding or firewall rules (Netplan client configuration does not do this)',
];
