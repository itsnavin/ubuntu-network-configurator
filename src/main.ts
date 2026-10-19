import './styles.css';
import { COMPAT, DOCS, MIN_NETPLAN, NOT_SUPPORTED, UBUNTU_RELEASES } from './lib/compat';
import { generateYaml } from './lib/generate';
import { discoveryCommands, installSteps, safeFileName, troubleshootingCommands } from './lib/guide';
import { netmaskToPrefix } from './lib/ip';
import { KIND_LABEL, defaultConfig, hasSecrets, newDevice, type Config, type Device, type Kind } from './lib/model';
import { PRESETS } from './lib/presets';
import { counts, validate, type Issue } from './lib/validate';
import { badge, codeBlock, h, inputId, msgId, selectField, textField } from './ui/dom';
import { renderEditor, type EditorCtx } from './ui/editor';

// All state lives in this module's memory only. Nothing is written to web storage,
// cookies, IndexedDB, URLs or any network endpoint.
const state = {
  cfg: defaultConfig() as Config,
  selected: '' as string,
  includeSecrets: false,
  revealed: new Set<string>(),
  issues: [] as Issue[],
};
state.selected = state.cfg.devices[0]?.uid ?? '';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function announce(text: string): void {
  const s = $('status');
  s.textContent = '';
  window.setTimeout(() => (s.textContent = text), 30);
}

async function copyText(text: string, what: string): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    announce(`${what} copied to the clipboard.`);
  } catch {
    announce(`Could not access the clipboard. Select the text and copy it manually.`);
  }
}

// ---------------- Global settings ----------------
function renderGlobal(): void {
  const { cfg } = state;
  const rel = UBUNTU_RELEASES.find((r) => r.version === cfg.ubuntu)!;
  const root = $('global-body');
  root.replaceChildren(
    selectField({
      key: 'ubuntu',
      label: 'Target Ubuntu release',
      help: `Netplan ${rel.netplanRelease} at release, ${rel.netplanUpdates}. This app only writes keys documented for Netplan ${MIN_NETPLAN} or older, so the YAML is the same for every listed release; the release changes guide hints (e.g. "netplan status" needs 0.106+).`,
      value: cfg.ubuntu,
      options: UBUNTU_RELEASES.map((r) => [r.version, `Ubuntu ${r.version} LTS (${r.codename})`]),
      onChange: (v) => {
        cfg.ubuntu = v as Config['ubuntu'];
        renderAll();
      },
    }),
    selectField({
      key: 'renderer',
      label: 'Renderer (network back end)',
      help: [
        'Which service applies the configuration. Ubuntu Server installs normally use systemd-networkd; Ubuntu Desktop normally uses NetworkManager (via 01-network-manager-all.yaml). This is the usual default, not a guarantee: check with ',
        h('code', {}, 'systemctl is-active systemd-networkd NetworkManager'),
        '. The chosen service must be installed and running. Mixing back ends for the same interface causes conflicts.',
      ],
      badges: [badge('applies to every interface', 'advanced')],
      value: cfg.renderer,
      options: [
        ['networkd', 'networkd (systemd-networkd) — typical for Ubuntu Server'],
        ['NetworkManager', 'NetworkManager — typical for Ubuntu Desktop'],
      ],
      onChange: (v) => {
        cfg.renderer = v as Config['renderer'];
        renderAll();
      },
    }),
    textField({
      key: 'fileName',
      label: 'File name in /etc/netplan',
      help: 'Files are merged in lexical order; later files override earlier ones. "60-" sorts after 50-cloud-init.yaml and 00-installer-config.yaml but before NetworkManager\'s 90-NM-*.yaml. Do not reuse an existing file name.',
      value: cfg.fileName,
      placeholder: '60-netplan-configurator.yaml',
      width: 'wide',
      onInput: (v) => {
        cfg.fileName = v;
        refresh();
        renderGuide();
      },
    }),
    renderNetmask(),
  );
}

function renderNetmask(): HTMLElement {
  const out = h('output', { id: 'netmask-out', for: 'netmask-in', 'aria-live': 'polite' }, 'Enter a netmask such as 255.255.255.0');
  return h(
    'div',
    { class: 'field' },
    h('label', { for: 'netmask-in', class: 'field-label' }, 'Netmask → prefix converter'),
    h('p', { class: 'help', id: 'netmask-help' }, 'Netplan needs prefix lengths (CIDR). Type a dotted netmask to see its prefix length.'),
    h('input', {
      id: 'netmask-in',
      type: 'text',
      class: 'w-medium',
      inputmode: 'decimal',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: '255.255.255.0',
      'aria-describedby': 'netmask-help netmask-out',
      onInput: (e: Event) => {
        const v = (e.target as HTMLInputElement).value.trim();
        if (!v) return void (out.textContent = 'Enter a netmask such as 255.255.255.0');
        const p = netmaskToPrefix(v);
        out.textContent = p === null ? `"${v}" is not a valid contiguous IPv4 netmask.` : `${v} = /${p}  (e.g. 192.168.1.50/${p})`;
      },
    }),
    out,
  );
}

// ---------------- Device list ----------------
function deviceIssueCount(d: Device): { e: number; w: number } {
  const mine = state.issues.filter((i) => i.deviceUid === d.uid);
  return { e: mine.filter((i) => i.level === 'error').length, w: mine.filter((i) => i.level === 'warning').length };
}

function suggestId(kind: Kind): string {
  const base = { ethernet: 'enp', wifi: 'wlp', bridge: 'br', bond: 'bond', vlan: 'vlan' }[kind];
  const used = new Set(state.cfg.devices.map((d) => d.id));
  if (kind === 'vlan') {
    for (let i = 10; ; i += 10) if (!used.has(`vlan${i}`)) return `vlan${i}`;
  }
  if (kind === 'ethernet' || kind === 'wifi') {
    for (let i = kind === 'ethernet' ? 3 : 2; ; i++) if (!used.has(`${base}${i}s0`)) return `${base}${i}s0`;
  }
  for (let i = 0; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
}

function addDevice(kind: Kind): void {
  const d = newDevice(kind, suggestId(kind));
  state.cfg.devices.push(d);
  state.selected = d.uid;
  renderAll();
  $('editor-heading')?.focus();
  announce(`Added ${KIND_LABEL[kind]} ${d.id}. Replace the example name with your real interface name.`);
}

function deleteDevice(d: Device): void {
  const refs = state.cfg.devices.filter((x) => x.members.includes(d.uid) || x.vlanLink === d.uid || x.bondPrimary === d.uid);
  const msg = refs.length
    ? `Delete ${d.id || 'this device'}? It is referenced by ${refs.map((r) => r.id || '(unnamed)').join(', ')}; those references will be flagged as errors for you to fix.`
    : `Delete ${d.id || 'this device'}?`;
  if (!window.confirm(msg)) return;
  const idx = state.cfg.devices.indexOf(d);
  state.cfg.devices = state.cfg.devices.filter((x) => x.uid !== d.uid);
  for (const ap of d.accessPoints) state.revealed.delete(ap.uid);
  const next = state.cfg.devices[Math.min(idx, state.cfg.devices.length - 1)];
  state.selected = next?.uid ?? '';
  renderAll();
  (next ? document.getElementById(`dev-${next.uid}`) : $('add-ethernet'))?.focus();
  announce(`Deleted ${d.id || 'device'}.`);
}

function moveDevice(d: Device, delta: number): void {
  const list = state.cfg.devices;
  const i = list.indexOf(d);
  const j = i + delta;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  renderAll();
  document.getElementById(`dev-${d.uid}`)?.focus();
}

function renderDeviceList(): void {
  const ul = $('device-list');
  const items = state.cfg.devices.map((d, i) => {
    const sel = d.uid === state.selected;
    const c = deviceIssueCount(d);
    return h(
      'li',
      { class: sel ? 'dev selected' : 'dev' },
      h(
        'button',
        {
          type: 'button',
          class: 'dev-select',
          id: `dev-${d.uid}`,
          'aria-current': sel ? 'true' : undefined,
          onClick: () => {
            state.selected = d.uid;
            renderAll();
            $('editor-heading')?.focus();
          },
        },
        h('span', { class: 'mono', 'data-device-label': d.uid }, d.id || '(unnamed)'),
        h('span', { class: 'dev-kind' }, KIND_LABEL[d.kind]),
        h('span', { class: 'dev-badges', 'data-device-counts': d.uid }, ...countBadges(c)),
      ),
      h(
        'div',
        { class: 'dev-actions' },
        h('button', { type: 'button', class: 'btn btn-small btn-ghost', 'aria-label': `Move ${d.id || 'device'} up`, disabled: i === 0, onClick: () => moveDevice(d, -1) }, '↑'),
        h('button', { type: 'button', class: 'btn btn-small btn-ghost', 'aria-label': `Move ${d.id || 'device'} down`, disabled: i === state.cfg.devices.length - 1, onClick: () => moveDevice(d, 1) }, '↓'),
        h('button', { type: 'button', class: 'btn btn-small btn-danger', id: `del-${d.uid}`, 'aria-label': `Delete ${d.id || 'device'}`, onClick: () => deleteDevice(d) }, 'Delete'),
      ),
    );
  });
  ul.replaceChildren(...(items.length ? items : [h('li', { class: 'empty' }, 'No interfaces yet. Add one below.')]));
}

function countBadges(c: { e: number; w: number }): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (c.e) out.push(h('span', { class: 'count count-error' }, `${c.e} error${c.e > 1 ? 's' : ''}`));
  if (c.w) out.push(h('span', { class: 'count count-warning' }, `${c.w} warning${c.w > 1 ? 's' : ''}`));
  if (!c.e && !c.w) out.push(h('span', { class: 'count count-ok' }, 'OK'));
  return out;
}

const editorCtx: EditorCtx = {
  get cfg() {
    return state.cfg;
  },
  structural: () => renderAll(),
  changed: () => refresh(),
  revealed: state.revealed,
};

function renderEditorPane(): void {
  const pane = $('editor');
  const d = state.cfg.devices.find((x) => x.uid === state.selected);
  pane.replaceChildren(d ? renderEditor(editorCtx, d) : h('p', { class: 'empty' }, 'Select or add an interface to edit it.'));
}

// ---------------- Issues, inline messages, preview ----------------
function refresh(): void {
  state.issues = validate(state.cfg);
  const c = counts(state.issues);

  // inline messages
  const boxes = document.querySelectorAll<HTMLElement>('[data-msg-for]');
  const byField = new Map<string, Issue[]>();
  for (const i of state.issues) byField.set(i.field, [...(byField.get(i.field) ?? []), i]);
  boxes.forEach((b) => {
    const list = byField.get(b.dataset.msgFor!) ?? [];
    b.replaceChildren(...list.map((i) => h('p', { class: `msg msg-${i.level}` }, h('span', { class: 'msg-level' }, `${levelLabel(i.level)}: `), i.message)));
  });
  document.querySelectorAll<HTMLElement>('[data-field]').forEach((el) => {
    const bad = (byField.get(el.dataset.field!) ?? []).some((i) => i.level === 'error');
    if (bad) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  });

  // device badges
  for (const d of state.cfg.devices) {
    const el = document.querySelector(`[data-device-counts="${d.uid}"]`);
    if (el) el.replaceChildren(...countBadges(deviceIssueCount(d)));
  }

  // summary + list
  $('issue-summary').textContent =
    c.error + c.warning + c.info === 0
      ? 'No problems found by the offline checks.'
      : `${c.error} error${c.error === 1 ? '' : 's'}, ${c.warning} warning${c.warning === 1 ? '' : 's'}, ${c.info} note${c.info === 1 ? '' : 's'}.`;
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...state.issues].sort((a, b) => order[a.level] - order[b.level]);
  $('issue-list').replaceChildren(
    ...sorted.map((i) => {
      const dev = state.cfg.devices.find((d) => d.uid === i.deviceUid);
      return h(
        'li',
        { class: `issue issue-${i.level}` },
        h('span', { class: 'msg-level' }, `${levelLabel(i.level)}`),
        ' ',
        dev ? h('span', { class: 'mono' }, `${dev.id || '(unnamed)'}: `) : null,
        i.message,
        ' ',
        h('button', { type: 'button', class: 'btn-link', onClick: () => goToIssue(i) }, 'Go to field'),
      );
    }),
  );

  renderPreview(c.error);
}

function levelLabel(l: Issue['level']): string {
  return l === 'error' ? 'Error' : l === 'warning' ? 'Warning' : 'Note';
}

function goToIssue(i: Issue): void {
  if (i.deviceUid && i.deviceUid !== state.selected) {
    state.selected = i.deviceUid;
    renderAll();
  }
  const target =
    document.getElementById(inputId(i.field)) ??
    document.getElementById(`${inputId(i.field)}_add`) ??
    document.getElementById(msgId(i.field)) ??
    (i.deviceUid ? $('editor-heading') : null);
  if (!target) return;
  let p: HTMLElement | null = target.parentElement;
  while (p) {
    if (p instanceof HTMLDetailsElement) p.open = true;
    p = p.parentElement;
  }
  if (!target.matches('input,select,button,textarea,[tabindex]')) target.setAttribute('tabindex', '-1');
  target.scrollIntoView({ block: 'center' });
  target.focus();
}

function currentYaml(maskSecrets: boolean): string | null {
  try {
    return generateYaml(state.cfg, { maskSecrets });
  } catch {
    return null;
  }
}

function renderPreview(errors: number): void {
  const secrets = hasSecrets(state.cfg);
  const yaml = currentYaml(true);
  const pre = $('yaml-preview');
  pre.textContent = yaml ?? '# The YAML cannot be generated until the errors listed above are fixed.';
  $('yaml-state').textContent =
    errors > 0
      ? `Preview only: fix ${errors} error${errors === 1 ? '' : 's'} before copying or downloading.`
      : secrets
        ? 'Wi-Fi passwords are masked in this preview. The copied/downloaded file will contain them in plain text.'
        : 'Ready. Review the YAML, then copy or download it.';
  $('yaml-state').className = errors > 0 ? 'state state-error' : 'state state-ok';

  const ack = $<HTMLInputElement>('ack-secrets');
  $('secrets-ack').hidden = !secrets;
  if (!secrets) {
    state.includeSecrets = false;
    ack.checked = false;
  }
  const blocked = errors > 0 || yaml === null || (secrets && !state.includeSecrets);
  for (const id of ['copy-yaml', 'download-yaml']) {
    const b = $<HTMLButtonElement>(id);
    b.disabled = blocked;
    b.setAttribute('aria-describedby', 'yaml-state gate-reason');
  }
  $('gate-reason').textContent =
    errors > 0 ? 'Disabled until all errors are fixed.' : secrets && !state.includeSecrets ? 'Tick the password acknowledgement to enable copy and download.' : '';
  $('download-name').textContent = safeFileName(state.cfg);
}

function exportYaml(): string | null {
  const c = counts(validate(state.cfg));
  if (c.error > 0) return null;
  if (hasSecrets(state.cfg) && !state.includeSecrets) return null;
  return currentYaml(false);
}

async function onCopy(): Promise<void> {
  const y = exportYaml();
  if (!y) return announce('Fix errors (and acknowledge password handling) first.');
  await copyText(y, hasSecrets(state.cfg) ? 'YAML including Wi-Fi passwords' : 'YAML');
  if (hasSecrets(state.cfg)) announce('YAML including Wi-Fi passwords copied. Clipboard managers may keep a history; clear it after pasting.');
}

function onDownload(): void {
  const y = exportYaml();
  if (!y) return announce('Fix errors (and acknowledge password handling) first.');
  const name = safeFileName(state.cfg);
  const url = URL.createObjectURL(new Blob([y], { type: 'application/yaml' }));
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce(`Downloaded ${name}. Install it with mode 600 (see the guide below).`);
}

// ---------------- Guide & compat ----------------
function renderDiscovery(): void {
  $('discovery-list').replaceChildren(...discoveryCommands().map((c) => codeBlock(c.cmd, c.why, copyText)));
}

function renderGuide(): void {
  const steps = installSteps(state.cfg);
  $('guide-steps').replaceChildren(
    ...steps.map((s, i) =>
      h(
        'li',
        { class: 'step' },
        h('h3', {}, `${i + 1}. ${s.title}`),
        ...s.body.map((p) => h('p', {}, p)),
        s.commands.length ? h('ol', { class: 'cmds' }, ...s.commands.map((c) => codeBlock(c.cmd, c.why, copyText))) : null,
      ),
    ),
  );
  const nm = state.cfg.renderer === 'NetworkManager';
  $('troubleshoot-list').replaceChildren(
    ...troubleshootingCommands(nm, state.cfg.devices.some((d) => d.kind === 'wifi')).map((c) => codeBlock(c.cmd, c.why, copyText)),
  );
}

function renderCompat(): void {
  const sup = (s: string) => (s === 'yes' ? 'Yes' : s === 'no' ? 'No' : 'Partial');
  $('compat-table').replaceChildren(
    h('caption', {}, 'Options this app can generate, by renderer (source: Netplan YAML reference)'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Option'), h('th', { scope: 'col' }, 'networkd'), h('th', { scope: 'col' }, 'NetworkManager'), h('th', { scope: 'col' }, 'Netplan'), h('th', { scope: 'col' }, 'Notes'))),
    h(
      'tbody',
      {},
      ...COMPAT.map((r) =>
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, h('code', {}, r.key), h('div', { class: 'help' }, r.area)),
          h('td', { class: `sup sup-${r.networkd}` }, sup(r.networkd)),
          h('td', { class: `sup sup-${r.nm}` }, sup(r.nm)),
          h('td', {}, r.since),
          h('td', {}, r.note),
        ),
      ),
    ),
  );
  $('not-supported').replaceChildren(...NOT_SUPPORTED.map((s) => h('li', {}, s)));
  $('release-table').replaceChildren(
    h('caption', {}, 'Netplan package versions (packages.ubuntu.com)'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Ubuntu'), h('th', { scope: 'col' }, 'Netplan at release'), h('th', { scope: 'col' }, 'Updates pocket'))),
    h('tbody', {}, ...UBUNTU_RELEASES.map((r) => h('tr', {}, h('th', { scope: 'row' }, `${r.version} (${r.codename})`), h('td', {}, r.netplanRelease), h('td', {}, r.netplanUpdates)))),
  );
}

function renderPresets(): void {
  const sel = $<HTMLSelectElement>('preset-select');
  sel.replaceChildren(...PRESETS.map((p) => h('option', { value: p.key }, p.title)));
  const desc = $('preset-desc');
  const upd = () => (desc.textContent = PRESETS.find((p) => p.key === sel.value)?.description ?? '');
  sel.addEventListener('change', upd);
  upd();
  $('preset-load').addEventListener('click', () => {
    const p = PRESETS.find((x) => x.key === sel.value);
    if (!p) return;
    if (state.cfg.devices.length && !window.confirm(`Replace the current configuration with "${p.title}"? Your current interfaces (and any typed passwords) will be discarded.`)) return;
    const next = p.build();
    next.ubuntu = state.cfg.ubuntu;
    state.cfg = next;
    state.selected = next.devices[0]?.uid ?? '';
    state.revealed.clear();
    state.includeSecrets = false;
    $<HTMLInputElement>('ack-secrets').checked = false;
    renderAll();
    announce(`Loaded example "${p.title}". Replace the example interface names and addresses with your own.`);
  });
}

function renderAll(): void {
  const active = document.activeElement as HTMLElement | null;
  const activeId = active?.id;
  const sel = active instanceof HTMLInputElement ? [active.selectionStart, active.selectionEnd] : null;
  const openDetails = new Set(Array.from(document.querySelectorAll<HTMLDetailsElement>('details.adv[open]')).map((d) => d.id));
  renderGlobal();
  renderDeviceList();
  renderEditorPane();
  document.querySelectorAll<HTMLDetailsElement>('details.adv').forEach((d) => {
    if (openDetails.has(d.id)) d.open = true;
  });
  renderGuide();
  refresh();
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el && el !== document.activeElement) {
      el.focus();
      if (sel && el instanceof HTMLInputElement && el.type === 'text') {
        try {
          el.setSelectionRange(sel[0], sel[1]);
        } catch {
          /* not all input types support selection */
        }
      }
    }
  }
}

function init(): void {
  for (const k of ['ethernet', 'wifi', 'bridge', 'bond', 'vlan'] as Kind[]) {
    $(`add-${k}`).addEventListener('click', () => addDevice(k));
  }
  $('copy-yaml').addEventListener('click', () => void onCopy());
  $('download-yaml').addEventListener('click', onDownload);
  $<HTMLInputElement>('ack-secrets').addEventListener('change', (e) => {
    state.includeSecrets = (e.target as HTMLInputElement).checked;
    refresh();
  });
  for (const [id, href] of Object.entries({ 'doc-yaml': DOCS.yaml, 'doc-try': DOCS.try, 'doc-structure': DOCS.structure, 'doc-generate': DOCS.generate, 'doc-cloudinit': DOCS.cloudInit, 'doc-ubuntu': DOCS.ubuntuNetworking, 'doc-packages': DOCS.packages, 'doc-security': DOCS.security })) {
    const a = document.getElementById(id);
    if (a) a.setAttribute('href', href);
  }
  renderDiscovery();
  renderPresets();
  renderCompat();
  renderAll();
}

init();
