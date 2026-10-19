# Ubuntu Network Configurator

A guided, **offline** web app that builds reviewed [Netplan](https://netplan.readthedocs.io/en/stable/netplan-yaml/) YAML for Ubuntu. It covers static and DHCP addressing (IPv4/IPv6), DNS, routes, Ethernet, Wi-Fi, bridges, bonds and VLANs, for both `systemd-networkd` and NetworkManager. A safe install and rollback guide is included.

**Live app:** https://itsnavin.github.io/ubuntu-network-configurator/

> The page **cannot see your network interfaces, never runs commands and never applies configuration.** It produces a text file that *you* must review and install. The offline checks cannot prove that your gateway exists, that a cable is connected or that a switch carries your VLAN. Nothing it generates is guaranteed to be correct or safe for your network.

## Features

- **Beginner first, advanced on demand.** Each interface starts with DHCP, static addresses, a default gateway and DNS. IPv6, DHCP overrides, link/MAC/MTU, Wi-Fi band/channel/BSSID, bridge and bond tuning sit in collapsible "Advanced" sections.
- **Every option is explained before use.** You get its purpose, units and format, plus a badge showing which renderer supports it (networkd, NetworkManager with a minimum NM version, or both) and the Netplan version it first appeared in.
- **Multiple interfaces.** Ethernet, Wi-Fi, bridge, bond and VLAN devices can be added, renamed, reordered and deleted. Members and parents are chosen from the devices you have defined.
- **Live validation.** Problems are shown inline, with `aria-invalid` on the field, plus a summary list with "Go to field" links. Copy and download stay disabled until every error is fixed. Nothing is silently truncated or replaced.
- **YAML preview, copy and download.** Wi-Fi passwords are masked in the preview. Exporting them requires an explicit acknowledgement, and the app warns about `chmod 600` and clipboard history.
- **Read-only discovery commands** for the target machine: `ip -br link`, `ip -br addr`, `ip route`, `resolvectl status`, `sudo netplan get`, etc., with placeholders like `<INTERFACE>`.
- **Install, test and rollback guide.** Covers lockout prevention, merging with existing files, backup, a non-overwriting install, `netplan generate`, `netplan try --timeout`, verification and manual rollback. The commands are generated from your file name and renderer.
- **Compatibility tables.** Option support per renderer, Netplan versions per Ubuntu release, and an explicit list of what the app deliberately does not support.
- **Examples:** DHCP, static IPv4, dual-stack, Wi-Fi, two uplinks with route metrics, and a VM host (bond → VLAN → bridge).

## Supported Ubuntu releases and renderers

| Ubuntu | netplan.io at release | Updates pocket | Verified in CI with `netplan generate` |
| --- | --- | --- | --- |
| 22.04 LTS (jammy) | 0.104 | 0.107.1 | `0.107.1-3ubuntu0.22.04.5` |
| 24.04 LTS (noble) | 1.0 | 1.1.2 | `1.1.2-8ubuntu1~24.04.3` |
| 26.04 LTS (resolute) | 1.2 | 1.2 | `1.2-1ubuntu5.1` |

The app only writes keys documented for Netplan **0.104 or older**, so a file is valid for every release listed. Ubuntu Server installs **usually** use `systemd-networkd`; Ubuntu Desktop **usually** uses NetworkManager (via `01-network-manager-all.yaml`). These are typical defaults, not guarantees, so check with `systemctl is-active systemd-networkd NetworkManager`.

## What it can generate

Sources: the [Netplan YAML reference](https://netplan.readthedocs.io/en/stable/netplan-yaml/) for each version and back end, and real `netplan generate` runs in CI.

| Option | networkd | NetworkManager | Notes |
| --- | --- | --- | --- |
| `dhcp4`, `dhcp6` | ✅ | ✅ | Always written explicitly. Can coexist with static addresses (explained in the UI). |
| `addresses` (CIDR) | ✅ | ✅ | IPv4/IPv6. Leading-zero octets, host/network mismatches and duplicates are rejected. |
| `routes`: `to`/`via`/`metric` | ✅ | ✅ | The default gateway is written as `to: default` + `via`. `gateway4`/`gateway6` are **never** emitted. |
| `routes`: `on-link` | ✅ | NM ≥ 1.12 (v4) / 1.18 (v6) | Only for gateways outside your subnets (e.g. `/32` cloud setups). |
| `routes`: `table` | ✅ | NM ≥ 1.10 | The app warns that other tables need policy rules, which it does not generate. |
| `nameservers`: `addresses`, `search` | ✅ | ✅ | |
| `dhcp4/6-overrides`: `use-routes`, `route-metric` | ✅ | ✅ | networkd: v4 and v6 overrides must be identical when both are on. "Copy DHCPv4 overrides to DHCPv6" helper. |
| `dhcp4/6-overrides`: `use-dns`, `use-ntp`, `use-hostname`, `send-hostname`, `hostname`, `use-mtu`, `use-domains` | ✅ | ❌ (blocked) | Documented as networkd-only. |
| `dhcp-identifier` | ✅ | ❌ (blocked) | |
| `accept-ra`, `ipv6-privacy`, `link-local` | ✅ | ✅ | |
| `ipv6-address-generation` | ❌ (blocked) | ✅ | Documented as NM-only. netplan 0.107 rejects it with networkd. |
| `match` (`macaddress`/`name`), `set-name`, `macaddress`, `mtu` | ✅ | ✅ / partial | MTU with networkd should use a MAC match. |
| `optional` | ✅ | ❌ (blocked) | |
| Wi-Fi client: open, WPA2-Personal (`psk`), WPA3-Personal (`sae`), `hidden`, `band`, `channel`, `bssid` | ✅ (needs `wpasupplicant`) | ✅ | SSID 1–32 UTF-8 bytes. Password 8–63 printable ASCII or 64 hex digits. |
| Bridges: `interfaces`, `stp`, `forward-delay`, `priority` | ✅ | ✅ | |
| Bonds: `mode`, `mii-monitor-interval`, `lacp-rate` (802.3ad), `transmit-hash-policy`, `primary` | ✅ | ✅ | Mode-specific options only where the kernel uses them. |
| VLANs: `id` (1–4094), `link` | ✅ | ✅ | Parent is an Ethernet, bond or bridge defined in the same file. |

### Configuration graph checks

The app checks the whole configuration, not just individual fields:

- missing or duplicate IDs and `set-name` collisions;
- members that don't exist, or that belong to more than one bridge or bond;
- cycles (for example a bridge inside itself through a VLAN);
- members that still carry IP, DNS or route settings;
- bond members that aren't Ethernet, and VLAN parents that don't exist;
- duplicate IPs across interfaces;
- several default routes in the same table with the same metric;
- a gateway that isn't inside an on-link subnet (unless `on-link` is set);
- IPv6 link-local next hops (`fe80::/10`), which are tied to the interface they are configured on.

### Deliberately not supported

- WPA/WPA2/WPA3-Enterprise (EAP/802.1X), and Wi-Fi access point or ad-hoc modes.
- `routing-policy`, route `type`/`scope`/`from`/`mtu`, routes without `via`. Netplan accepts a route without `via` (a link-scope route), but this app always requires a gateway.
- Per-device renderer overrides, tunnels, WireGuard, VRF, veth, dummy devices, modems, SR-IOV, InfiniBand, Open vSwitch, and `nm-devices`.
- Offload toggles, wake-on-LAN, LLDP, and address lifetime/label options.
- Advanced bridge timers and bond ARP monitoring.
- The deprecated `gateway4`/`gateway6` keys.
- **Netplan is not a router.** It does not set up a DHCP server, NAT, IP forwarding or a firewall.

## Privacy and security

- Everything runs in your browser. There is **no backend, analytics, cookies, web storage, IndexedDB, URL state or logging.** Reloading the page clears everything.
- Wi-Fi password inputs use `type=password` and `autocomplete=off`. Passwords live only in page memory, are masked in the preview, and are exported only after you tick an acknowledgement. Remember that clipboard managers and synced download folders may keep copies.
- The production build ships a strict Content-Security-Policy (`default-src 'none'`, `script-src 'self'`, `connect-src 'none'`), and all code is bundled. There are **zero runtime dependencies** and no CDNs or external fonts.
- User text never reaches the DOM as markup; the app uses `textContent`/`value` only. YAML is produced by a small custom emitter that **double-quotes every user string and key**, so a value like `no`, `0123`, `2001:db8::1`, an SSID with `: #` or a password with quotes can't change YAML types or inject structure.
- Netplan files with Wi-Fi passwords must be `root:root` with mode **600**. The guide's install command does this and refuses to overwrite an existing file.

## Safe installation (summary)

The full, file-name-aware guide is in the app. Key points:

1. **Have console or out-of-band access** before changing a remote machine's network.
2. Files in `/etc/netplan`, `/run/netplan` and `/lib/netplan` are **merged**, and later file names override earlier ones. Your file is **not** an isolated replacement. cloud-init's `50-cloud-init.yaml` may be regenerated, so don't blindly disable cloud-init networking. NetworkManager may store GUI connections as `90-NM-*.yaml`.
3. **Back up** into a timestamped `$BACKUP` directory: copy `/etc/netplan`, save the merged `netplan get` output, and copy the cloud-init and NetworkManager settings.
4. Install without overwriting: `sudo install -m 600 -o root -g root <file> /etc/netplan/<file>`, guarded by an "already exists → STOP" check.
5. Run `sudo netplan generate`. This checks syntax and schema only; it does **not** prove the network works.
6. From a local console, run `sudo netplan try --timeout 120`. It rolls back automatically if not confirmed. It has limitations with virtual devices (bridges, bonds, VLANs) and is not an absolute guarantee, so read `man netplan-try`. Do not use `netplan apply` as a first step.
7. Verify with `ip -br addr`, `ip route`, `resolvectl status`, `ping <GATEWAY-IP>`, and `networkctl` or `nmcli`.
8. Roll back by moving the new file into the backup directory (and restoring the original files if needed). Then run `sudo netplan generate`, and `sudo netplan apply` from a local console.

The page never runs these commands. The renderer service (systemd-networkd or NetworkManager) and, for Wi-Fi with networkd, `wpasupplicant` must already be installed. The guide only shows read-only checks for them.

## Development

Requirements: Node.js 20+ and npm.

```sh
npm ci
npm run dev          # http://localhost:5173
npm run typecheck
npm test             # unit tests (Vitest)
npm run build        # production build in dist/ (with CSP)
npm run preview      # serve dist/ on http://localhost:4173
npx playwright install chromium
npm run test:e2e     # browser tests (desktop + mobile Chromium) against the production build
```

`E2E_BASE_URL=https://itsnavin.github.io/ubuntu-network-configurator/ npm run test:e2e` runs the same browser tests against the live site.

### Project layout

- `src/lib/`: framework-free logic.
  - `ip.ts`: IPv4/IPv6/CIDR parsing.
  - `yaml.ts`: safe YAML emitter.
  - `model.ts`, `validate.ts`, `generate.ts`.
  - `compat.ts`: compatibility data and doc links.
  - `guide.ts`: install and troubleshooting commands.
  - `presets.ts`.
- `src/ui/`, `src/main.ts`, `index.html`, `src/styles.css`: the accessible UI (vanilla TypeScript, no framework).
- `tests/`: unit tests.
  - IP parsing; YAML round-trip with the independent `yaml` parser.
  - Generation for every mode and option; validation, including invalid cases, graph topology and renderer restrictions.
  - Privacy/static-analysis scans; committed-fixture checks.
- `e2e/`: Playwright tests.
  - Desktop and mobile layouts, keyboard navigation, interface create/read/update/delete, validation and "Go to field".
  - Password masking and acknowledgement gating, copy (clipboard) and download (file name and content).
  - No storage, no foreign requests, no horizontal overflow.
- `fixtures/`
  - `valid/`: generated from `tests/scenarios.ts`. Regenerate with `UPDATE_FIXTURES=1 npm run fixtures`.
  - `invalid/`: hand-written; must be rejected by netplan.
  - `warn/`: must be accepted with a netplan warning.
- `scripts/netplan-generate-fixtures.sh`: real netplan check (see below).

### Real `netplan generate` in CI (no live networking)

The `.github/workflows/netplan.yml` workflow runs in disposable `ubuntu:22.04`, `ubuntu:24.04` and `ubuntu:26.04` containers on GitHub Actions. In each one it installs `netplan.io` and, for every fixture:

1. copies it into a temporary `--root-dir`;
2. sets mode 600 on it;
3. runs `netplan generate --root-dir <tmp>`.

Valid fixtures must produce systemd-networkd units or NetworkManager keyfiles. Invalid fixtures (mismatched networkd DHCP overrides, an undefined bridge member, a member in two masters, a VLAN without a link or with ID 4095, a malformed address) must be rejected. The duplicate-default-route fixture must trigger netplan's "Conflicting default route declarations" warning.

The workflow **never runs `netplan apply` or `netplan try`**, never touches the runner's `/etc/netplan`, and never starts, stops or installs network services outside the throw-away container. No live network configuration is applied or validated anywhere: CI proves that netplan *parses and renders* the files, not that they work on a real network.

Running it caught three real-world differences, which the app now handles:

- `ipv6-address-generation` is rejected with networkd on 22.04.
- Netplan accepts routes without `via`.
- Duplicate default routes only produce a warning.

## Limitations

- The app can't detect hardware, interface names, link state, routability or reachability. Use the discovery commands.
- Checks are offline and syntactic. Passing them, or `netplan generate`, does not mean the configuration will work or keep you connected.
- Back-end behaviour can differ between Netplan and NetworkManager/systemd versions. Always consult the documentation for the version installed (`netplan --version`, `dpkg -s netplan.io`).
- Not affiliated with Canonical or the Netplan project.

## License

MIT
