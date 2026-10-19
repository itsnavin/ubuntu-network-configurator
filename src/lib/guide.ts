import type { Config } from './model';
import { FILE_RE, ID_RE } from './validate';

export interface Cmd {
  cmd: string;
  why: string;
}

export interface Step {
  title: string;
  body: string[];
  commands: Cmd[];
}

export const FILE_PLACEHOLDER = '60-netplan-configurator.yaml';

export function safeFileName(cfg: Config): string {
  const f = cfg.fileName.trim();
  return FILE_RE.test(f) ? f : FILE_PLACEHOLDER;
}

/** Read-only discovery commands. None of these change the system. */
export function discoveryCommands(): Cmd[] {
  return [
    { cmd: 'ip -br link', why: 'Interface names and MAC addresses (use these names or MACs in the form).' },
    { cmd: 'ip -br addr', why: 'Addresses currently assigned to each interface.' },
    { cmd: 'ip route; ip -6 route', why: 'Current IPv4 / IPv6 routes, including the default gateway.' },
    { cmd: 'resolvectl status', why: 'DNS servers and search domains per link (systemd-resolved).' },
    { cmd: 'ls -la /etc/netplan /run/netplan /lib/netplan 2>/dev/null', why: 'Every existing Netplan file. All of them are merged together.' },
    { cmd: 'sudo netplan get', why: 'The merged configuration Netplan currently sees. Note: it prints Wi-Fi passwords to the terminal.' },
    { cmd: 'sudo netplan status --all', why: 'Netplan 0.106+ only (24.04, 26.04 and 22.04 with jammy-updates). Shows state per interface.' },
    { cmd: 'systemctl is-active systemd-networkd NetworkManager', why: 'Which back end is running. Ubuntu Server usually uses networkd; Ubuntu Desktop usually uses NetworkManager.' },
    { cmd: 'networkctl list 2>/dev/null; nmcli device status 2>/dev/null', why: 'Per-device state as seen by networkd / NetworkManager.' },
    { cmd: 'cloud-init status 2>/dev/null; ls /etc/cloud/cloud.cfg.d/ 2>/dev/null', why: 'Whether cloud-init manages networking (common on cloud and installer-built servers).' },
    { cmd: "dpkg-query -W -f='${Status} ${Version}\\n' netplan.io wpasupplicant network-manager 2>/dev/null", why: 'Installed Netplan, wpa_supplicant and NetworkManager package versions (read-only).' },
  ];
}

function idPattern(cfg: Config): string {
  const ids = cfg.devices.map((d) => d.id.trim()).filter((id) => ID_RE.test(id));
  if (!ids.length) return 'enp3s0';
  return ids.map((id) => id.replace(/\./g, '\\.')).join('|');
}

export function installSteps(cfg: Config): Step[] {
  const f = safeFileName(cfg);
  const nm = cfg.renderer === 'NetworkManager';
  const hasWifi = cfg.devices.some((d) => d.kind === 'wifi');
  const hasVirtual = cfg.devices.some((d) => d.kind === 'bridge' || d.kind === 'bond' || d.kind === 'vlan');
  const ids = idPattern(cfg);
  return [
    {
      title: 'Make sure you cannot lock yourself out',
      body: [
        'Use a local console, or out-of-band access (IPMI/iLO/iDRAC, hypervisor or cloud serial console) before changing the network of a remote machine. An SSH session alone can be cut off by a mistake.',
        'Plan a maintenance window. Nothing on this page runs any command for you: copy commands deliberately and read them first.',
      ],
      commands: [],
    },
    {
      title: 'Inspect what is configured today (read-only)',
      body: [
        'Netplan merges every *.yaml file in /lib/netplan, /etc/netplan and /run/netplan in lexical order of the file name. Later files add new keys and override keys that already exist. Adding a file is NOT an isolated replacement of the old configuration.',
        'If an existing file (for example 50-cloud-init.yaml or 00-installer-config.yaml) configures the same interface ID, both files apply. Check every file that mentions your interfaces.',
        'On Ubuntu Desktop 23.10+ NetworkManager can store its own connections as /etc/netplan/90-NM-*.yaml; those sort after a "60-" file and can override it.',
      ],
      commands: [
        ...discoveryCommands().slice(4, 6),
        { cmd: `sudo grep -n -E '${ids}' /etc/netplan/*.yaml /run/netplan/*.yaml /lib/netplan/*.yaml 2>/dev/null`, why: 'Find other files that already mention the same interface IDs.' },
      ],
    },
    {
      title: 'Back up the existing configuration',
      body: ['Keep the backup on the machine and note its path. It may contain Wi-Fi passwords, so it is only readable by root.'],
      commands: [
        { cmd: 'BACKUP="/root/netplan-backup-$(date +%Y%m%d-%H%M%S)"', why: 'Choose a timestamped backup directory.' },
        { cmd: 'sudo mkdir -m 700 "$BACKUP" && sudo cp -a /etc/netplan "$BACKUP/"', why: 'Copy /etc/netplan with permissions intact.' },
        { cmd: 'sudo sh -c \'netplan get > "$1/netplan-get-merged.yaml"; chmod 600 "$1/netplan-get-merged.yaml"\' sh "$BACKUP"', why: 'Save the merged view Netplan sees today.' },
        { cmd: 'sudo cp -a /etc/cloud/cloud.cfg.d "$BACKUP/" 2>/dev/null; ' + (nm ? 'sudo cp -a /etc/NetworkManager/system-connections "$BACKUP/" 2>/dev/null; ' : '') + 'sudo ls -laR "$BACKUP"', why: 'Also keep cloud-init' + (nm ? ' and NetworkManager' : '') + ' settings, then list the backup.' },
        { cmd: 'echo "$BACKUP"', why: 'Write this path down; you need it to roll back.' },
      ],
    },
    {
      title: 'Copy the downloaded file into place without overwriting anything',
      body: [
        `Transfer ${f} to the machine (for example with scp) into your home directory first. The install command refuses to run if a file with the same name already exists.`,
        'Mode 600 and root ownership are required because the file may contain Wi-Fi passwords; Netplan also warns about world-readable files.',
      ],
      commands: [
        { cmd: `F="${f}"; ls -l ~/"$F"`, why: 'Confirm the downloaded file is where you expect it.' },
        { cmd: 'if sudo test -e "/etc/netplan/$F"; then echo "STOP: /etc/netplan/$F already exists - review it first"; else sudo install -m 600 -o root -g root ~/"$F" "/etc/netplan/$F"; fi', why: 'Install with mode 600, never overwriting an existing file.' },
        { cmd: 'sudo ls -l /etc/netplan/', why: 'Check permissions (-rw-------) and the file order.' },
      ],
    },
    {
      title: 'Validate before touching live interfaces',
      body: [
        '"netplan generate" parses ALL Netplan files and writes back-end configuration into /run. It catches YAML and schema errors, but it cannot tell whether addresses, gateways or VLANs are correct for your network or reachable.',
        'It does not restart networking by itself, but the generated configuration will be used at the next boot or apply, so do not leave a broken file in place.',
      ],
      commands: [
        { cmd: 'sudo netplan generate', why: 'Must finish with no errors. Fix the YAML (or remove the file) if it reports any.' },
        { cmd: 'sudo netplan get', why: 'Review the merged result, including keys inherited from other files.' },
      ],
    },
    {
      title: 'Test with automatic rollback: netplan try',
      body: [
        'Run this from the local/out-of-band console. "netplan try" applies the configuration and reverts it automatically unless you confirm within the timeout (default 120 seconds). If you confirm, the new configuration stays applied: no separate "netplan apply" is needed.',
        'Limits (from the netplan-try manual): it uses the same mechanism as "netplan apply", so the caveats about virtual devices apply' + (hasVirtual ? ' — bridges, bonds and VLANs created by the new configuration may not be removed on revert, and custom bond/bridge parameters may be reported as not revertable' : '') + '. If it times out or is cancelled, verify that the configuration was really reverted. STP bridges can take over a minute to settle.',
        'If "netplan try" refuses or reports the configuration is not revertable, do not fall back to "netplan apply" over SSH. Only apply from a console, with the rollback steps below ready.',
      ],
      commands: [{ cmd: 'sudo netplan try --timeout 120', why: 'Press Enter to keep the configuration only after checking connectivity from a second session/console.' }],
    },
    {
      title: 'Verify (read-only)',
      body: ['Check addresses, routes and DNS, and that you can reach the gateway and a name.'],
      commands: [
        { cmd: 'ip -br addr; ip route; ip -6 route', why: 'Addresses and routes now in effect.' },
        { cmd: 'resolvectl status', why: 'DNS servers per interface.' },
        { cmd: 'ping -c 3 <GATEWAY-IP>', why: 'Replace <GATEWAY-IP> with your gateway.' },
        { cmd: 'resolvectl query ubuntu.com', why: 'Name resolution works.' },
        ...troubleshootingCommands(nm, hasWifi),
      ],
    },
    {
      title: 'Roll back if something is wrong',
      body: [
        'Remove (move) the new file, regenerate, and apply from the console. Rollback is a manual procedure and is not guaranteed to restore every runtime state: virtual devices created by the new configuration may remain until removed or until reboot. Verify the files on disk before rebooting.',
      ],
      commands: [
        { cmd: `sudo mv "/etc/netplan/${f}" "$BACKUP/removed-${f}"`, why: 'Take the new file out of /etc/netplan (kept in the backup directory).' },
        { cmd: 'sudo ls -l /etc/netplan/ && sudo netplan generate', why: 'Confirm only the original files remain and they still validate.' },
        { cmd: 'sudo netplan apply', why: 'Only from a local console: re-applies the original configuration.' },
        { cmd: 'sudo cp -a "$BACKUP/netplan/." /etc/netplan/', why: 'If original files were changed, restore them from the backup, then generate/apply again.' },
      ],
    },
  ];
}

export function troubleshootingCommands(nm: boolean, hasWifi: boolean): Cmd[] {
  const out: Cmd[] = nm
    ? [
        { cmd: 'nmcli device status; nmcli connection show', why: 'NetworkManager view of devices and Netplan-generated connections (named netplan-*).' },
        { cmd: 'journalctl -u NetworkManager -b --no-pager | tail -n 50', why: 'Recent NetworkManager log messages.' },
        { cmd: 'ls -l /run/NetworkManager/system-connections/', why: 'Files generated by Netplan for NetworkManager.' },
      ]
    : [
        { cmd: 'networkctl list; networkctl status <INTERFACE>', why: 'networkd link state. Replace <INTERFACE>.' },
        { cmd: 'journalctl -u systemd-networkd -b --no-pager | tail -n 50', why: 'Recent systemd-networkd log messages.' },
        { cmd: 'ls -l /run/systemd/network/', why: 'Files generated by Netplan for networkd.' },
      ];
  if (hasWifi && !nm) {
    out.push({ cmd: "systemctl list-units 'netplan-wpa-*' --no-pager", why: 'wpa_supplicant units Netplan uses for Wi-Fi with networkd.' });
  }
  return out;
}
