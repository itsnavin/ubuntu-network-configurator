import { DOCS } from '../lib/compat';
import {
  BOND_MODES,
  HASH_POLICIES,
  KIND_LABEL,
  emptyOverrides,
  newAccessPoint,
  newRoute,
  type AccessPoint,
  type Config,
  type Device,
  type DhcpOverrides,
  type Route,
  type Tri,
} from '../lib/model';
import { badge, checkField, details, h, inputId, listField, msgBox, selectField, textField } from './dom';

export interface EditorCtx {
  cfg: Config;
  /** Re-render everything (structure changed). */
  structural: () => void;
  /** Only recompute issues/preview (a value changed). */
  changed: () => void;
  /** Wi-Fi password visibility toggles, kept in memory only. */
  revealed: Set<string>;
}

const NMD = () => badge('networkd only', 'networkd');
const BOTH = () => badge('networkd + NetworkManager', 'both');
const SINCE = (v: string) => badge(`Netplan ${v}+`, 'version');

const TRI: [string, string][] = [
  ['default', 'Not set (back-end default)'],
  ['true', 'Yes (true)'],
  ['false', 'No (false)'],
];

function link(href: string, text: string): HTMLElement {
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
}

export function renderEditor(ctx: EditorCtx, d: Device): HTMLElement {
  const { cfg } = ctx;
  const K = (f: string) => `${d.uid}.${f}`;
  const set = <T extends keyof Device>(k: T, v: Device[T], structural = false) => {
    d[k] = v;
    if (structural) ctx.structural();
    else ctx.changed();
  };
  const physical = d.kind === 'ethernet' || d.kind === 'wifi';
  const nm = cfg.renderer === 'NetworkManager';

  const parts: (HTMLElement | null)[] = [];

  // ---- Identity ----
  parts.push(
    h('h3', { id: `editor-heading`, tabindex: '-1' }, `Editing ${KIND_LABEL[d.kind]}: `, h('span', { class: 'mono' }, d.id || '(unnamed)')),
    textField({
      key: K('id'),
      label: physical ? 'Interface name / ID' : `${KIND_LABEL[d.kind]} name`,
      help: physical
        ? [
            'The Netplan ID. Without a match rule it must be the exact kernel interface name shown by ',
            h('code', {}, 'ip -br link'),
            ' (e.g. enp3s0, eth0, wlp2s0). Names like the examples here are placeholders: replace them with yours. Max 15 characters.',
          ]
        : `Name of the virtual interface to create (e.g. ${d.kind === 'bridge' ? 'br0' : d.kind === 'bond' ? 'bond0' : 'vlan10'}). Max 15 characters; must not clash with any other ID.`,
      value: d.id,
      placeholder: physical ? (d.kind === 'wifi' ? 'wlp2s0' : 'enp3s0') : '',
      maxlength: 15,
      width: 'narrow',
      onInput: (v) => {
        set('id', v);
        const el = document.querySelector(`[data-device-label="${d.uid}"]`);
        if (el) el.textContent = v || '(unnamed)';
        const hd = document.querySelector('#editor-heading .mono');
        if (hd) hd.textContent = v || '(unnamed)';
      },
    }),
  );

  // ---- IPv4 / IPv6 addressing (beginner) ----
  const addr: HTMLElement[] = [
    h(
      'p',
      { class: 'help' },
      'Choose DHCP to get an address automatically from your router/DHCP server, or enter fixed (static) addresses. Both can be used together: static addresses are added in addition to the DHCP lease. Netplan only configures this machine as a client; it does not run a DHCP server.',
    ),
    checkField({
      key: K('dhcp4'),
      label: 'Get an IPv4 address automatically (DHCPv4)',
      help: 'dhcp4: true. Most home and office networks use this. Leave off for a static-only server.',
      badges: [BOTH()],
      checked: d.dhcp4,
      onChange: (v) => set('dhcp4', v, true),
    }),
    checkField({
      key: K('dhcp6'),
      label: 'Use DHCPv6',
      help: 'dhcp6: true. Requests IPv6 address/options from a DHCPv6 server. Many IPv6 networks instead use router advertisements (SLAAC, see IPv6 options) which work without DHCPv6.',
      badges: [BOTH()],
      checked: d.dhcp6,
      onChange: (v) => set('dhcp6', v, true),
    }),
    listField({
      key: K('addresses'),
      label: 'Static addresses (CIDR)',
      help: 'Format: address/prefix-length, e.g. 192.168.1.50/24 or 2001:db8::50/64. "/24" equals netmask 255.255.255.0 (use the netmask converter in Global settings). IPv4 octets must not have leading zeros.',
      badges: [BOTH()],
      items: d.addresses,
      itemLabel: (i) => `Static address ${i + 1}`,
      placeholder: '192.168.1.50/24',
      addLabel: 'Add static address',
      onItem: (i, v) => {
        d.addresses[i] = v;
        ctx.changed();
      },
      onAdd: () => set('addresses', [...d.addresses, ''], true),
      onRemove: (i) => set('addresses', d.addresses.filter((_, j) => j !== i), true),
    }),
  ];
  parts.push(h('section', { class: 'group', 'aria-labelledby': `${d.uid}-g-addr` }, h('h4', { id: `${d.uid}-g-addr` }, 'IP addresses'), ...addr));

  // ---- Gateway & routes ----
  parts.push(renderRoutes(ctx, d));

  // ---- DNS ----
  parts.push(
    h(
      'section',
      { class: 'group', 'aria-labelledby': `${d.uid}-g-dns` },
      h('h4', { id: `${d.uid}-g-dns` }, 'DNS'),
      listField({
        key: K('nameservers'),
        label: 'DNS servers',
        help: 'IPv4 or IPv6 addresses of DNS resolvers (no port, no prefix). With DHCP these are added to the servers the DHCP server provides (unless you set DHCP override use-dns: false with networkd).',
        badges: [BOTH()],
        items: d.nameservers,
        itemLabel: (i) => `DNS server ${i + 1}`,
        placeholder: '1.1.1.1',
        addLabel: 'Add DNS server',
        onItem: (i, v) => {
          d.nameservers[i] = v;
          ctx.changed();
        },
        onAdd: () => set('nameservers', [...d.nameservers, ''], true),
        onRemove: (i) => set('nameservers', d.nameservers.filter((_, j) => j !== i), true),
      }),
      listField({
        key: K('search'),
        label: 'Search domains',
        help: 'Domains appended to short host names, e.g. "example.lan" lets "nas" resolve as nas.example.lan.',
        badges: [BOTH()],
        items: d.search,
        itemLabel: (i) => `Search domain ${i + 1}`,
        placeholder: 'example.lan',
        addLabel: 'Add search domain',
        onItem: (i, v) => {
          d.search[i] = v;
          ctx.changed();
        },
        onAdd: () => set('search', [...d.search, ''], true),
        onRemove: (i) => set('search', d.search.filter((_, j) => j !== i), true),
      }),
    ),
  );

  // ---- Kind-specific ----
  if (d.kind === 'wifi') parts.push(renderWifi(ctx, d));
  if (d.kind === 'bridge' || d.kind === 'bond') parts.push(renderMembers(ctx, d));
  if (d.kind === 'bridge') parts.push(renderBridgeParams(ctx, d));
  if (d.kind === 'bond') parts.push(renderBondParams(ctx, d));
  if (d.kind === 'vlan') parts.push(renderVlan(ctx, d));

  // ---- Advanced: IPv6 ----
  parts.push(
    details(
      'Advanced: IPv6 options',
      d.acceptRa !== 'default' || d.linkLocal !== 'default' || d.ipv6Privacy || d.ipv6AddressGeneration !== 'default',
      `${d.uid}-adv-ipv6`,
      selectField({
        key: K('acceptRa'),
        label: 'Accept IPv6 router advertisements (accept-ra)',
        help: 'Router advertisements (RA) let IPv6 routers announce prefixes (SLAAC addresses) and a default route. "Not set" keeps the kernel default (normally accept unless forwarding is enabled). Set "No" on static-only IPv6 servers if you do not want automatic addresses/routes.',
        badges: [BOTH()],
        value: d.acceptRa,
        options: TRI,
        onChange: (v) => set('acceptRa', v as Tri, true),
      }),
      selectField({
        key: K('linkLocal'),
        label: 'Link-local addressing (link-local)',
        help: 'Link-local addresses (fe80::/10, 169.254.0.0/16) are only valid on this one link. IPv6 needs fe80:: for neighbour discovery and RA, so it is on by default. Default (not set) = IPv6 only.',
        badges: [badge('NetworkManager: no effect with DHCP', 'nm')],
        value: d.linkLocal,
        options: [
          ['default', 'Not set (IPv6 link-local only)'],
          ['ipv6', 'IPv6 only'],
          ['ipv4', 'IPv4 only'],
          ['both', 'IPv4 and IPv6'],
          ['none', 'None (disable)'],
        ],
        onChange: (v) => set('linkLocal', v as Device['linkLocal'], true),
      }),
      checkField({
        key: K('ipv6Privacy'),
        label: 'IPv6 privacy extensions (ipv6-privacy)',
        help: 'Adds temporary, changing IPv6 addresses for outgoing connections (RFC 4941). Useful on laptops; usually off on servers.',
        badges: [BOTH()],
        checked: d.ipv6Privacy,
        onChange: (v) => set('ipv6Privacy', v),
      }),
      selectField({
        key: K('ipv6AddressGeneration'),
        label: 'SLAAC address generation (ipv6-address-generation)',
        help: 'How the interface part of SLAAC addresses is built: eui64 (from the MAC) or stable-privacy (stable but not derived from the MAC). NetworkManager only.',
        badges: [SINCE('0.99'), badge('NetworkManager only', 'nm')],
        value: d.ipv6AddressGeneration,
        options: [
          ['default', 'Not set (back-end default)'],
          ['eui64', 'eui64'],
          ['stable-privacy', 'stable-privacy'],
        ],
        onChange: (v) => set('ipv6AddressGeneration', v as Device['ipv6AddressGeneration']),
      }),
    ),
  );

  // ---- Advanced: DHCP ----
  if (d.dhcp4 || d.dhcp6 || hasAnyOverride(d)) parts.push(renderDhcpAdvanced(ctx, d));

  // ---- Advanced: link ----
  const link: HTMLElement[] = [];
  if (physical) {
    link.push(
      h('p', { class: 'help' }, 'Optional. Match rules identify the NIC by MAC or name pattern instead of the ID, which is useful when names can change. With a match rule the ID above is just a label unless you also set "Rename to".'),
      textField({
        key: K('matchMac'),
        label: 'Match by MAC address (match: macaddress)',
        help: 'The permanent MAC shown by "ip -br link", e.g. 52:54:00:12:34:56.',
        badges: [BOTH()],
        value: d.matchMac,
        placeholder: '52:54:00:12:34:56',
        width: 'medium',
        onInput: (v) => set('matchMac', v),
      }),
      textField({
        key: K('matchName'),
        label: 'Match by name (match: name)',
        help: 'Kernel name or glob such as "enp*". A glob can match several NICs.',
        badges: [badge('NetworkManager ≥1.14', 'nm')],
        value: d.matchName,
        placeholder: 'enp3s0',
        maxlength: 15,
        width: 'narrow',
        onInput: (v) => set('matchName', v),
      }),
      textField({
        key: K('setName'),
        label: 'Rename to (set-name)',
        help: 'Give the matched NIC a stable new name. Requires a match rule; takes effect when udev renames the device (usually at boot).',
        value: d.setName,
        maxlength: 15,
        width: 'narrow',
        onInput: (v) => set('setName', v),
      }),
    );
  }
  link.push(
    textField({
      key: K('macaddress'),
      label: 'Set MAC address (macaddress)',
      help: 'Overrides the hardware address (MAC spoofing / fixed MAC for a bond or bridge). Leave empty to keep the default.',
      badges: [BOTH()],
      value: d.macaddress,
      placeholder: '52:54:00:aa:bb:cc',
      onInput: (v) => set('macaddress', v),
    }),
    textField({
      key: K('mtu'),
      label: 'MTU (bytes)',
      help: 'Maximum packet size in bytes. Default is usually 1500; 9000 for jumbo frames only if every switch and host on the path supports it. IPv6 needs ≥1280.',
      badges: [BOTH()],
      value: d.mtu,
      placeholder: '1500',
      inputmode: 'numeric',
      width: 'narrow',
      onInput: (v) => set('mtu', v),
    }),
    checkField({
      key: K('optional'),
      label: 'Optional at boot (optional: true)',
      help: 'networkd will not wait for this link during boot (systemd-networkd-wait-online). Useful for interfaces that are often unplugged.',
      badges: [NMD()],
      checked: d.optional,
      onChange: (v) => set('optional', v),
    }),
  );
  parts.push(
    details(
      physical ? 'Advanced: device matching, MAC, MTU, boot' : 'Advanced: MAC, MTU, boot',
      Boolean(d.matchMac || d.matchName || d.setName || d.macaddress || d.mtu || d.optional),
      `${d.uid}-adv-link`,
      ...link,
    ),
  );

  if (nm) {
    parts.push(h('p', { class: 'help note' }, 'Renderer is NetworkManager: options marked "networkd only" are reported as errors instead of being written, because NetworkManager would ignore them.'));
  }

  return h('div', { class: 'editor' }, ...parts.filter(Boolean));
}

function hasAnyOverride(d: Device): boolean {
  const e = JSON.stringify(emptyOverrides());
  return JSON.stringify(d.dhcp4Overrides) !== e || JSON.stringify(d.dhcp6Overrides) !== e || d.dhcpIdentifier !== 'default';
}

function renderRoutes(ctx: EditorCtx, d: Device): HTMLElement {
  const K = (f: string) => `${d.uid}.${f}`;
  const addRoute = (r: Partial<Route>) => {
    d.routes.push(newRoute(r));
    ctx.structural();
  };
  const rows = d.routes.map((r, i) => {
    const RK = (x: string) => K(`routes.${r.uid}.${x}`);
    const upd = (k: keyof Route, v: string | boolean) => {
      (r as unknown as Record<string, unknown>)[k] = v;
      ctx.changed();
    };
    return h(
      'fieldset',
      { class: 'route' },
      h('legend', {}, r.to.trim() === 'default' ? `Route ${i + 1} (default gateway)` : `Route ${i + 1}`),
      h(
        'div',
        { class: 'grid' },
        textField({ key: RK('to'), label: 'Destination (to)', help: '"default" for the default gateway, or a network like 10.20.0.0/16.', value: r.to, placeholder: 'default', width: 'medium', onInput: (v) => upd('to', v) }),
        textField({ key: RK('via'), label: 'Gateway / next hop (via)', help: 'Router address. Must be reachable directly on this link (inside one of its subnets), unless on-link is set.', value: r.via, placeholder: '192.168.1.1', width: 'medium', onInput: (v) => upd('via', v) }),
        textField({ key: RK('metric'), label: 'Metric', help: 'Priority; lower wins when several routes match. Empty = back-end default.', value: r.metric, placeholder: '100', inputmode: 'numeric', width: 'narrow', onInput: (v) => upd('metric', v) }),
        textField({ key: RK('table'), label: 'Table', help: 'Routing table number. Leave empty for the main table.', badges: [badge('NetworkManager ≥1.10', 'nm')], value: r.table, inputmode: 'numeric', width: 'narrow', onInput: (v) => upd('table', v) }),
      ),
      checkField({
        key: RK('onLink'),
        label: 'Gateway is directly attached even though it is outside my subnet (on-link)',
        help: 'Exception for setups such as some cloud/hosting /32 addresses where the provider documents a gateway outside your prefix. Do not use it to silence a "gateway not reachable" error caused by a typo.',
        badges: [badge('NetworkManager ≥1.12 IPv4 / ≥1.18 IPv6', 'nm')],
        checked: r.onLink,
        onChange: (v) => upd('onLink', v),
      }),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small btn-danger',
          id: `${inputId(RK('remove'))}`,
          onClick: () => {
            d.routes = d.routes.filter((x) => x.uid !== r.uid);
            ctx.structural();
          },
        },
        `Remove route ${i + 1}`,
      ),
    );
  });
  return h(
    'section',
    { class: 'group', 'aria-labelledby': `${d.uid}-g-routes` },
    h('h4', { id: `${d.uid}-g-routes` }, 'Gateway and routes'),
    h(
      'p',
      { class: 'help' },
      'A default gateway is written as a route with "to: default" (the old gateway4/gateway6 keys are deprecated and never generated). Define at most one default route per IP family per table across all interfaces, or give them different metrics. With DHCP, the gateway normally comes from the DHCP server, so you usually do not add one here. IPv6 link-local gateways (fe80::…) are scoped to this interface automatically. ',
      link(DOCS.defaultRoutes, 'Netplan: default routes'),
    ),
    ...rows,
    h(
      'div',
      { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-small', id: `${inputId(K('routes'))}_addgw`, onClick: () => addRoute({ to: 'default' }) }, 'Add default gateway'),
      h('button', { type: 'button', class: 'btn btn-small', id: `${inputId(K('routes'))}_add`, onClick: () => addRoute({ to: '' }) }, 'Add static route'),
    ),
    msgBox(K('routes')),
  );
}

function overridesBlock(ctx: EditorCtx, d: Device, fam: 4 | 6): HTMLElement {
  const key = fam === 4 ? 'dhcp4Overrides' : 'dhcp6Overrides';
  const o: DhcpOverrides = d[key];
  const K = (f: string) => `${d.uid}.${key}.${f}`;
  const upd = <T extends keyof DhcpOverrides>(k: T, v: DhcpOverrides[T]) => {
    o[k] = v;
    ctx.changed();
  };
  const tri = (k: 'useDns' | 'useNtp' | 'useHostname' | 'sendHostname' | 'useMtu' | 'useRoutes', label: string, help: string, nmOk: boolean) =>
    selectField({ key: K(k), label, help, badges: [nmOk ? BOTH() : NMD()], value: o[k], options: TRI, onChange: (v) => upd(k, v as Tri) });
  return h(
    'fieldset',
    { class: 'overrides' },
    h('legend', {}, `dhcp${fam}-overrides`, fam === 4 && !d.dhcp4 ? ' (DHCPv4 is off)' : '', fam === 6 && !d.dhcp6 ? ' (DHCPv6 is off)' : ''),
    tri('useRoutes', 'Use routes from DHCP (use-routes)', 'No = ignore the gateway/routes the DHCP server sends (e.g. second NIC that must not become the default path).', true),
    textField({ key: K('routeMetric'), label: 'Metric for DHCP routes (route-metric)', help: 'Lower = preferred. Use different values on two DHCP interfaces to choose the primary uplink.', badges: [BOTH()], value: o.routeMetric, inputmode: 'numeric', width: 'narrow', placeholder: '100', onInput: (v) => upd('routeMetric', v) }),
    tri('useDns', 'Use DNS servers from DHCP (use-dns)', 'No = only use the DNS servers you list.', false),
    selectField({
      key: K('useDomains'),
      label: 'Use search domains from DHCP (use-domains)',
      help: '"route" uses the domain only for routing DNS queries, not as a search suffix.',
      badges: [NMD(), SINCE('0.98')],
      value: o.useDomains,
      options: [...TRI, ['route', 'route']],
      onChange: (v) => upd('useDomains', v as DhcpOverrides['useDomains']),
    }),
    tri('useNtp', 'Use NTP servers from DHCP (use-ntp)', 'Time servers advertised by DHCP.', false),
    tri('useHostname', 'Set hostname from DHCP (use-hostname)', 'Lets the DHCP server change this machine\'s transient hostname.', false),
    tri('sendHostname', 'Send hostname to DHCP server (send-hostname)', 'Lets the DHCP server/router register this machine\'s name.', false),
    textField({ key: K('hostname'), label: 'Hostname to send (hostname)', help: 'Overrides the name sent when send-hostname is on.', badges: [NMD()], value: o.hostname, width: 'medium', onInput: (v) => upd('hostname', v) }),
    tri('useMtu', 'Use MTU from DHCP (use-mtu)', 'Apply the MTU option the DHCP server sends.', false),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-small btn-ghost',
        id: `${inputId(`${d.uid}.${key}`)}_reset`,
        onClick: () => {
          d[key] = emptyOverrides();
          ctx.structural();
        },
      },
      `Reset dhcp${fam}-overrides`,
    ),
    msgBox(`${d.uid}.${key}`),
  );
}

function renderDhcpAdvanced(ctx: EditorCtx, d: Device): HTMLElement {
  const both = d.dhcp4 && d.dhcp6;
  return details(
    'Advanced: DHCP client options',
    hasAnyOverride(d),
    `${d.uid}-adv-dhcp`,
    h(
      'p',
      { class: 'help' },
      'Overrides change how this machine uses what the DHCP server sends. They only apply when the matching DHCP family is enabled. With NetworkManager, only use-routes and route-metric are honoured; the others are networkd only. ',
      both && ctx.cfg.renderer === 'networkd' ? h('strong', {}, 'networkd requires dhcp4-overrides and dhcp6-overrides to be identical when both are enabled. ') : null,
      link(DOCS.dhcpOverrides, 'Netplan: DHCP overrides'),
    ),
    selectField({
      key: `${d.uid}.dhcpIdentifier`,
      label: 'DHCP client identifier (dhcp-identifier)',
      help: '"mac" makes networkd identify itself by MAC address like most other OSes (useful if the DHCP server reserves addresses by MAC). Default is the DUID.',
      badges: [NMD()],
      value: d.dhcpIdentifier,
      options: [
        ['default', 'Not set (duid)'],
        ['mac', 'mac'],
        ['duid', 'duid'],
      ],
      onChange: (v) => {
        d.dhcpIdentifier = v as Device['dhcpIdentifier'];
        ctx.changed();
      },
    }),
    d.dhcp4 || JSON.stringify(d.dhcp4Overrides) !== JSON.stringify(emptyOverrides()) ? overridesBlock(ctx, d, 4) : null,
    d.dhcp6 || JSON.stringify(d.dhcp6Overrides) !== JSON.stringify(emptyOverrides()) ? overridesBlock(ctx, d, 6) : null,
    both
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn btn-small',
            id: `${inputId(`${d.uid}.dhcp6Overrides`)}_copy`,
            onClick: () => {
              d.dhcp6Overrides = { ...d.dhcp4Overrides };
              ctx.structural();
            },
          },
          'Copy DHCPv4 overrides to DHCPv6',
        )
      : null,
  );
}

function renderWifi(ctx: EditorCtx, d: Device): HTMLElement {
  const nm = ctx.cfg.renderer === 'NetworkManager';
  const aps = d.accessPoints.map((ap, i) => renderAp(ctx, d, ap, i));
  return h(
    'section',
    { class: 'group', 'aria-labelledby': `${d.uid}-g-wifi` },
    h('h4', { id: `${d.uid}-g-wifi` }, 'Wi-Fi networks'),
    h(
      'p',
      { class: 'help' },
      'Client (infrastructure) mode with Open, WPA2-Personal (PSK) or WPA3-Personal (SAE). Enterprise/802.1X and hotspot (access point) mode are not supported by this app. ',
      nm ? 'NetworkManager handles Wi-Fi natively.' : 'With networkd, Netplan uses wpa_supplicant (package "wpasupplicant") — check it is installed: dpkg -s wpasupplicant.',
      ' ',
      link(DOCS.wifis, 'Netplan: Wi-Fi'),
    ),
    h(
      'div',
      { class: 'warning', role: 'note' },
      h('strong', {}, 'Password privacy: '),
      'passwords stay only in this browser tab\'s memory. They are never saved, logged or sent anywhere, and are masked in the preview. The downloaded file contains them in plain text: store it with chmod 600 and delete copies you no longer need.',
    ),
    ...aps,
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-small',
        id: `${inputId(`${d.uid}.accessPoints`)}_add`,
        onClick: () => {
          d.accessPoints.push(newAccessPoint());
          ctx.structural();
        },
      },
      'Add another Wi-Fi network',
    ),
    msgBox(`${d.uid}.accessPoints`),
  );
}

function renderAp(ctx: EditorCtx, d: Device, ap: AccessPoint, i: number): HTMLElement {
  const K = (x: string) => `${d.uid}.ap.${ap.uid}.${x}`;
  const upd = <T extends keyof AccessPoint>(k: T, v: AccessPoint[T], structural = false) => {
    ap[k] = v;
    if (structural) ctx.structural();
    else ctx.changed();
  };
  const pwKey = K('password');
  const pwId = inputId(pwKey);
  const shown = ctx.revealed.has(ap.uid);
  const pw =
    ap.security === 'open'
      ? null
      : h(
          'div',
          { class: 'field' },
          h('label', { for: pwId, class: 'field-label' }, 'Password (passphrase)', badge('secret', 'secret')),
          h('p', { class: 'help', id: `${pwId}_help` }, '8–63 printable ASCII characters, or exactly 64 hexadecimal digits (a pre-computed key). Case-sensitive; spaces are kept exactly as typed.'),
          h(
            'div',
            { class: 'pw-row' },
            h('input', {
              id: pwId,
              type: shown ? 'text' : 'password',
              value: ap.password,
              autocomplete: 'off',
              autocapitalize: 'off',
              spellcheck: 'false',
              'data-lpignore': 'true',
              'data-1p-ignore': 'true',
              class: 'w-wide',
              'aria-describedby': `${pwId}_help ${pwId.replace(/^f_/, 'm_')}`,
              'data-field': pwKey,
              'data-secret': 'true',
              onInput: (e: Event) => upd('password', (e.target as HTMLInputElement).value),
            }),
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn-small btn-ghost',
                id: `${pwId}_toggle`,
                'aria-pressed': shown ? 'true' : 'false',
                'aria-controls': pwId,
                onClick: () => {
                  if (shown) ctx.revealed.delete(ap.uid);
                  else ctx.revealed.add(ap.uid);
                  ctx.structural();
                },
              },
              shown ? 'Hide password' : 'Show password',
            ),
          ),
          msgBox(pwKey),
        );
  return h(
    'fieldset',
    { class: 'ap' },
    h('legend', {}, `Wi-Fi network ${i + 1}`),
    textField({
      key: K('ssid'),
      label: 'Network name (SSID)',
      help: 'Exactly as broadcast: case, spaces and symbols matter. 1–32 bytes (UTF-8; emoji and accented letters use more than one byte).',
      value: ap.ssid,
      placeholder: 'HomeNetwork',
      width: 'wide',
      onInput: (v) => upd('ssid', v),
    }),
    selectField({
      key: K('security'),
      label: 'Security',
      help: 'WPA2-Personal is the most common home setting. WPA3-Personal (SAE) needs a compatible driver/back end. "Open" sends traffic unencrypted.',
      value: ap.security,
      options: [
        ['psk', 'WPA2-Personal (PSK) — password'],
        ['sae', 'WPA3-Personal (SAE) — password'],
        ['open', 'Open (no password)'],
      ],
      onChange: (v) => upd('security', v as AccessPoint['security'], true),
    }),
    pw,
    details(
      'Advanced: hidden network, band, channel, BSSID',
      ap.hidden || ap.band !== 'any' || Boolean(ap.channel || ap.bssid),
      `${ap.uid}-adv`,
      checkField({ key: K('hidden'), label: 'Hidden network (hidden: true)', help: 'The SSID is not broadcast; a slower active scan is used.', badges: [SINCE('0.100')], checked: ap.hidden, onChange: (v) => upd('hidden', v) }),
      selectField({
        key: K('band'),
        label: 'Band',
        help: 'Restrict to one frequency band. Leave "Any" unless you need it.',
        badges: [SINCE('0.99')],
        value: ap.band,
        options: [
          ['any', 'Any'],
          ['2.4GHz', '2.4GHz'],
          ['5GHz', '5GHz'],
        ],
        onChange: (v) => upd('band', v as AccessPoint['band'], true),
      }),
      textField({ key: K('channel'), label: 'Channel', help: 'Only used when a band is set: 1–14 (2.4GHz) or 32–177 (5GHz).', badges: [SINCE('0.99')], value: ap.channel, inputmode: 'numeric', width: 'narrow', onInput: (v) => upd('channel', v) }),
      textField({ key: K('bssid'), label: 'Lock to access point MAC (bssid)', help: 'Connect only to this specific access point (aa:bb:cc:dd:ee:ff).', badges: [SINCE('0.99')], value: ap.bssid, placeholder: 'aa:bb:cc:dd:ee:ff', onInput: (v) => upd('bssid', v) }),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-small btn-danger',
        id: `${inputId(K('remove'))}`,
        onClick: () => {
          d.accessPoints = d.accessPoints.filter((x) => x.uid !== ap.uid);
          ctx.revealed.delete(ap.uid);
          ctx.structural();
        },
      },
      `Remove Wi-Fi network ${i + 1}`,
    ),
  );
}

function renderMembers(ctx: EditorCtx, d: Device): HTMLElement {
  const { cfg } = ctx;
  const allowed = d.kind === 'bond' ? ['ethernet'] : ['ethernet', 'bond', 'vlan'];
  const candidates = cfg.devices.filter((x) => x.uid !== d.uid && (allowed.includes(x.kind) || d.members.includes(x.uid)));
  const dangling = d.members.filter((m) => !cfg.devices.some((x) => x.uid === m));
  const K = `${d.uid}.members`;
  return h(
    'fieldset',
    { class: 'group' },
    h('legend', {}, d.kind === 'bond' ? 'Bond members (interfaces)' : 'Bridge ports (interfaces)'),
    h(
      'p',
      { class: 'help' },
      d.kind === 'bond'
        ? 'Ethernet interfaces combined into this bond. Add them as Ethernet interfaces first (with no addresses). The IP configuration goes on the bond.'
        : 'Interfaces attached to this bridge (Ethernet, bond or VLAN). Add them first, without addresses; the IP configuration goes on the bridge. Wi-Fi client interfaces cannot be bridged.',
      ' ',
      link(d.kind === 'bond' ? DOCS.bonds : DOCS.bridges, 'Netplan docs'),
    ),
    candidates.length
      ? h(
          'ul',
          { class: 'checklist' },
          ...candidates.map((c) => {
            const idx = d.members.indexOf(c.uid);
            const id = inputId(`${K}.${c.uid}`);
            return h(
              'li',
              {},
              h('input', {
                type: 'checkbox',
                id,
                checked: idx >= 0,
                'data-field': `${K}.${c.uid}`,
                onChange: (e: Event) => {
                  const on = (e.target as HTMLInputElement).checked;
                  d.members = on ? [...d.members, c.uid] : d.members.filter((m) => m !== c.uid);
                  if (!on && d.bondPrimary === c.uid) d.bondPrimary = '';
                  ctx.structural();
                },
              }),
              h('label', { for: id }, h('span', { class: 'mono' }, c.id || '(unnamed)'), ` — ${KIND_LABEL[c.kind]}`),
              idx >= 0 ? msgBox(`${K}.${idx}`) : null,
            );
          }),
        )
      : h('p', { class: 'empty' }, d.kind === 'bond' ? 'No Ethernet interfaces yet. Add Ethernet interfaces first.' : 'No eligible interfaces yet. Add Ethernet, bond or VLAN devices first.'),
    ...dangling.map((m) => {
      const idx = d.members.indexOf(m);
      return h(
        'div',
        { class: 'dangling' },
        h('span', {}, 'Deleted device still listed as a member. '),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-small',
            id: inputId(`${K}.${idx}.fix`),
            onClick: () => {
              d.members = d.members.filter((x) => x !== m);
              ctx.structural();
            },
          },
          'Remove reference',
        ),
        msgBox(`${K}.${idx}`),
      );
    }),
    msgBox(K),
  );
}

function renderBridgeParams(ctx: EditorCtx, d: Device): HTMLElement {
  return details(
    'Bridge parameters',
    d.bridgeStp !== 'default' || Boolean(d.bridgeForwardDelay || d.bridgePriority),
    `${d.uid}-adv-bridge`,
    selectField({
      key: `${d.uid}.bridgeStp`,
      label: 'Spanning Tree Protocol (stp)',
      help: 'STP prevents loops when the bridge has several ports into the same network. For a VM host bridge with one uplink, "No" avoids a ~30 s delay before traffic flows. Default: on.',
      badges: [BOTH()],
      value: d.bridgeStp,
      options: TRI,
      onChange: (v) => {
        d.bridgeStp = v as Tri;
        ctx.changed();
      },
    }),
    textField({
      key: `${d.uid}.bridgeForwardDelay`,
      label: 'Forward delay (seconds)',
      help: 'Time spent in listening/learning states before forwarding (forward-delay). 0 is common with STP off.',
      badges: [BOTH()],
      value: d.bridgeForwardDelay,
      inputmode: 'numeric',
      width: 'narrow',
      onInput: (v) => {
        d.bridgeForwardDelay = v;
        ctx.changed();
      },
    }),
    textField({
      key: `${d.uid}.bridgePriority`,
      label: 'Bridge priority (0–65535)',
      help: 'STP root election priority (priority). Lower wins. Default 32768.',
      badges: [BOTH()],
      value: d.bridgePriority,
      inputmode: 'numeric',
      width: 'narrow',
      onInput: (v) => {
        d.bridgePriority = v;
        ctx.changed();
      },
    }),
  );
}

const BOND_HELP: Record<string, string> = {
  'active-backup': 'One member active, others standby. Works with any switch. Recommended default.',
  '802.3ad': 'LACP: dynamic aggregation; requires LACP configured on the switch.',
  'balance-rr': 'Round-robin across members; requires static aggregation on the switch; may reorder packets.',
  'balance-xor': 'Hash-based balancing; requires static aggregation on the switch.',
  broadcast: 'Sends everything on all members; special use only.',
  'balance-tlb': 'Adaptive transmit load balancing; no switch support needed.',
  'balance-alb': 'Adaptive load balancing (transmit and receive); no switch support needed.',
};

function renderBondParams(ctx: EditorCtx, d: Device): HTMLElement {
  const m = d.bondMode;
  const K = (f: string) => `${d.uid}.${f}`;
  const memberOpts: [string, string][] = d.members.map((u) => [u, ctx.cfg.devices.find((x) => x.uid === u)?.id || '(deleted)']);
  return h(
    'section',
    { class: 'group', 'aria-labelledby': `${d.uid}-g-bond` },
    h('h4', { id: `${d.uid}-g-bond` }, 'Bond parameters'),
    selectField({
      key: K('bondMode'),
      label: 'Mode',
      help: BOND_HELP[m],
      badges: [BOTH()],
      value: m,
      options: BOND_MODES.map((x) => [x, x]),
      onChange: (v) => {
        d.bondMode = v as Device['bondMode'];
        ctx.structural();
      },
    }),
    textField({
      key: K('bondMiiMonitorInterval'),
      label: 'MII link monitor interval (milliseconds)',
      help: 'How often member link state is checked (mii-monitor-interval). 100 is common; 0 disables failure detection.',
      badges: [BOTH()],
      value: d.bondMiiMonitorInterval,
      inputmode: 'numeric',
      width: 'narrow',
      onInput: (v) => {
        d.bondMiiMonitorInterval = v;
        ctx.changed();
      },
    }),
    m === '802.3ad' || d.bondLacpRate !== 'default'
      ? selectField({
          key: K('bondLacpRate'),
          label: 'LACP rate (lacp-rate)',
          help: 'How often LACP partners exchange packets: slow (30 s) or fast (1 s). 802.3ad only.',
          badges: [BOTH()],
          value: d.bondLacpRate,
          options: [
            ['default', 'Not set (slow)'],
            ['slow', 'slow'],
            ['fast', 'fast'],
          ],
          onChange: (v) => {
            d.bondLacpRate = v as Device['bondLacpRate'];
            ctx.structural();
          },
        })
      : null,
    ['balance-xor', '802.3ad', 'balance-tlb'].includes(m) || d.bondTransmitHashPolicy !== 'default'
      ? selectField({
          key: K('bondTransmitHashPolicy'),
          label: 'Transmit hash policy (transmit-hash-policy)',
          help: 'Which headers choose the member for each flow. layer3+4 spreads flows best but is not fully 802.3ad-compliant for fragmented traffic; layer2 is the default.',
          badges: [BOTH()],
          value: d.bondTransmitHashPolicy,
          options: [['default', 'Not set (layer2)'], ...HASH_POLICIES.filter((x) => x !== 'default').map((x) => [x, x] as [string, string])],
          onChange: (v) => {
            d.bondTransmitHashPolicy = v as Device['bondTransmitHashPolicy'];
            ctx.structural();
          },
        })
      : null,
    ['active-backup', 'balance-tlb', 'balance-alb'].includes(m) || d.bondPrimary
      ? selectField({
          key: K('bondPrimary'),
          label: 'Preferred member (primary)',
          help: 'Member used whenever it is up. Must be one of the members above.',
          badges: [BOTH()],
          value: d.bondPrimary,
          options: [['', 'None'], ...memberOpts],
          onChange: (v) => {
            d.bondPrimary = v;
            ctx.structural();
          },
        })
      : null,
  );
}

function renderVlan(ctx: EditorCtx, d: Device): HTMLElement {
  const parents = ctx.cfg.devices.filter((x) => x.uid !== d.uid && ['ethernet', 'bond', 'bridge'].includes(x.kind));
  const opts: [string, string][] = [['', 'Choose parent…'], ...parents.map((p) => [p.uid, `${p.id || '(unnamed)'} — ${KIND_LABEL[p.kind]}`] as [string, string])];
  if (d.vlanLink && !ctx.cfg.devices.some((x) => x.uid === d.vlanLink)) opts.push([d.vlanLink, '(deleted device)']);
  return h(
    'section',
    { class: 'group', 'aria-labelledby': `${d.uid}-g-vlan` },
    h('h4', { id: `${d.uid}-g-vlan` }, 'VLAN settings'),
    h('p', { class: 'help' }, 'An 802.1Q tagged VLAN on top of a parent interface. The switch port must carry this VLAN tagged. ', link(DOCS.vlans, 'Netplan: VLANs')),
    textField({
      key: `${d.uid}.vlanId`,
      label: 'VLAN ID (1–4094)',
      help: 'The 802.1Q tag number configured on your switch.',
      badges: [BOTH()],
      value: d.vlanId,
      inputmode: 'numeric',
      width: 'narrow',
      placeholder: '10',
      onInput: (v) => {
        d.vlanId = v;
        ctx.changed();
      },
    }),
    selectField({
      key: `${d.uid}.vlanLink`,
      label: 'Parent interface (link)',
      help: 'Ethernet, bond or bridge defined in this configuration. If the parent is a bond member, create the VLAN on the bond instead.',
      badges: [BOTH()],
      value: d.vlanLink,
      options: opts,
      onChange: (v) => {
        d.vlanLink = v;
        ctx.structural();
      },
    }),
  );
}
