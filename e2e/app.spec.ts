import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const PASSWORD = `s3cr3t "pa:ss" #'x`;

async function open(page: Page) {
  const foreign: string[] = [];
  const origin = new URL(test.info().project.use.baseURL!).origin;
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(origin) && !/^(data|blob):/.test(u)) foreign.push(u);
  });
  page.on('dialog', (d) => d.accept());
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1, name: 'Ubuntu Network Configurator' })).toBeVisible();
  return foreign;
}

const preview = (page: Page) => page.locator('#yaml-preview');
const editor = (page: Page) => page.locator('#editor');

async function loadPreset(page: Page, key: string) {
  await page.locator('#preset-select').selectOption(key);
  await page.locator('#preset-load').click();
}

test('loads offline with a valid default DHCP config and makes no foreign requests', async ({ page }) => {
  const foreign = await open(page);
  await expect(page.locator('#issue-summary')).toHaveText(/No problems found|0 errors/);
  await expect(preview(page)).toContainText('network:');
  await expect(preview(page)).toContainText('dhcp4: true');
  await expect(page.locator('#copy-yaml')).toBeEnabled();
  await expect(page.locator('#compat-table tbody tr').first()).toBeVisible();
  await expect(page.locator('#discovery-list li').first()).toContainText('ip');
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(foreign).toEqual([]);
});

test('edits an interface to static IPv4 with a default route and DNS', async ({ page }) => {
  await open(page);
  const ed = editor(page);
  const name = ed.getByLabel('Interface name / ID');
  await name.fill('eth0');
  await expect(page.locator('#device-list')).toContainText('eth0');
  await ed.getByLabel('Get an IPv4 address automatically (DHCPv4)').uncheck();
  await ed.getByRole('button', { name: 'Add static address' }).click();
  await ed.getByLabel('Static address 1', { exact: true }).fill('192.168.1.50/24');
  await ed.getByRole('button', { name: /default gateway/i }).click();
  await ed.getByLabel('Gateway / next hop (via)').fill('192.168.1.1');
  await ed.getByRole('button', { name: /Add DNS server/i }).click();
  await ed.locator('fieldset', { hasText: 'DNS servers' }).locator('input').first().fill('1.1.1.1');
  await expect(page.locator('#issue-summary')).not.toContainText(/[1-9]\d* error/);
  const y = await preview(page).textContent();
  expect(y).toContain('"eth0":');
  expect(y).toContain('dhcp4: false');
  expect(y).toContain('"192.168.1.50/24"');
  expect(y).toMatch(/to: "default"\s+via: "192.168.1.1"/);
  expect(y).toContain('"1.1.1.1"');
  expect(y).not.toContain('gateway4');
});

test('shows inline validation, blocks export, and "Go to field" focuses the bad input', async ({ page }) => {
  await open(page);
  const ed = editor(page);
  await ed.getByRole('button', { name: 'Add static address' }).click();
  const addr = ed.getByLabel('Static address 1', { exact: true });
  await addr.fill('192.168.001.300/24');
  await expect(addr).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#issue-summary')).toContainText(/[1-9] error/);
  await expect(page.locator('#copy-yaml')).toBeDisabled();
  await expect(page.locator('#download-yaml')).toBeDisabled();
  await expect(page.locator('#gate-reason')).toContainText('Disabled until all errors are fixed');
  await page.locator('#issue-list li.issue-error').first().getByRole('button', { name: 'Go to field' }).click();
  await expect(addr).toBeFocused();
  await addr.fill('192.168.1.30/24');
  await expect(addr).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#copy-yaml')).toBeEnabled();
});

test('adds, renames, reorders and deletes interfaces; references are graph-checked', async ({ page }) => {
  await open(page);
  await page.locator('#add-ethernet').click();
  await expect(page.locator('#editor-heading')).toBeFocused();
  await page.locator('#add-bridge').click();
  const ed = editor(page);
  await expect(ed.getByLabel('Bridge name')).toHaveValue('br0');
  const members = ed.getByRole('checkbox', { name: /enp/ });
  await members.first().check();
  await expect(preview(page)).toContainText('bridges:');
  expect(await preview(page).textContent()).toMatch(/interfaces:[\s\S]*"enp3s0"/);
  // The member still has DHCP on: the app should flag IP config on an enslaved interface.
  await expect(page.locator('#issue-list')).toContainText(/member of br0|bridge/i);
  await page.locator('#device-list .dev-select', { hasText: 'enp3s0' }).first().click();
  await editor(page).getByLabel('Get an IPv4 address automatically (DHCPv4)').uncheck();
  const count = await page.locator('#device-list li.dev').count();
  expect(count).toBe(3);
  await page.getByRole('button', { name: 'Move br0 up' }).click();
  await expect(page.locator('#device-list li.dev').nth(1)).toContainText('br0');
  await page.getByRole('button', { name: 'Delete enp3s0' }).first().click();
  await expect(page.locator('#device-list li.dev')).toHaveCount(2);
  // The bridge loses its member: dangling reference is removed or flagged, never silently emitted.
  expect(await preview(page).textContent()).not.toContain('"enp3s0"');
});

test('VLAN and bond builder generates graph-valid YAML (VM host example)', async ({ page }) => {
  await open(page);
  await loadPreset(page, 'vm-host');
  const y = (await preview(page).textContent())!;
  expect(y).toContain('bonds:');
  expect(y).toContain('vlans:');
  expect(y).toContain('bridges:');
  expect(y).toContain('link: "bond0"');
  await expect(page.locator('#issue-list li.issue-error')).toHaveCount(0);
});

test('renderer switch surfaces NetworkManager restrictions visibly', async ({ page }) => {
  await open(page);
  await loadPreset(page, 'static-ipv4');
  await page.locator('#editor details', { hasText: /link|Hardware/i }).last().evaluate((d) => ((d as HTMLDetailsElement).open = true));
  await editor(page).getByLabel('Optional at boot (optional: true)').check();
  await page.locator('#f_renderer').selectOption('NetworkManager');
  await expect(page.locator('#issue-list')).toContainText(/optional/i);
  await expect(preview(page)).toContainText('renderer: "NetworkManager"');
});

test('Wi-Fi password is hidden, masked in preview, and gated behind an acknowledgement', async ({ page }) => {
  await open(page);
  await loadPreset(page, 'wifi');
  const pw = editor(page).getByLabel('Password (passphrase)');
  await expect(pw).toHaveAttribute('type', 'password');
  await expect(pw).toHaveAttribute('autocomplete', 'off');
  await expect(page.locator('#copy-yaml')).toBeDisabled(); // empty password is an error
  await pw.fill(PASSWORD);
  await expect(preview(page)).not.toContainText(PASSWORD);
  await expect(preview(page)).not.toContainText('s3cr3t');
  await expect(page.locator('#secrets-ack')).toBeVisible();
  await expect(page.locator('#copy-yaml')).toBeDisabled();
  await expect(page.locator('#gate-reason')).toContainText('acknowledgement');

  const toggle = editor(page).getByRole('button', { name: 'Show password' });
  await toggle.click();
  await expect(editor(page).getByLabel('Password (passphrase)')).toHaveAttribute('type', 'text');
  await expect(editor(page).getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
  await editor(page).getByRole('button', { name: 'Hide password' }).click();
  await expect(editor(page).getByLabel('Password (passphrase)')).toHaveAttribute('type', 'password');

  await page.locator('#ack-secrets').check();
  await expect(page.locator('#copy-yaml')).toBeEnabled();

  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#download-yaml').click()]);
  const text = readFileSync((await dl.path())!, 'utf8');
  expect(text).toContain(`password: "s3cr3t \\"pa:ss\\" #'x"`);
  expect(text).toContain('chmod 600');

  // Nothing persisted anywhere the page can reach.
  const persisted = await page.evaluate(async () => {
    const dbs = 'databases' in indexedDB ? await indexedDB.databases() : [];
    return JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie, url: location.href, dbs });
  });
  expect(persisted).not.toContain('s3cr3t');
});

test('copy puts exactly the reviewed YAML on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await loadPreset(page, 'dual-stack');
  await page.locator('#copy-yaml').click();
  await expect(page.locator('#status')).toContainText('copied');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(await preview(page).textContent());
  expect(clip).toContain('dhcp6:');
});

test('download is named from the file name field and matches the preview', async ({ page }) => {
  await open(page);
  await page.locator('#f_fileName').fill('70-office.yaml');
  await expect(page.locator('#download-name')).toHaveText('70-office.yaml');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#download-yaml').click()]);
  expect(dl.suggestedFilename()).toBe('70-office.yaml');
  expect(readFileSync((await dl.path())!, 'utf8')).toBe(await preview(page).textContent());
});

test('fields cannot inject raw YAML', async ({ page }) => {
  await open(page);
  await editor(page).getByLabel('Interface name / ID').fill('eth0\n  dhcp6: true');
  await expect(page.locator('#copy-yaml')).toBeDisabled();
  await editor(page).getByLabel('Interface name / ID').fill('eth0: {x: 1}');
  await expect(page.locator('#issue-summary')).toContainText(/[1-9] error/);
  await expect(preview(page)).not.toContainText('{x: 1}:');
});

test('keyboard: skip link, add buttons and editor are reachable', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard navigation checked on desktop');
  await open(page);
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await page.locator('#add-wifi').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#editor-heading')).toBeFocused();
  await expect(page.locator('#editor-heading')).toContainText('Wi-Fi');
  await page.keyboard.press('Tab');
  await expect(editor(page).getByLabel('Interface name / ID')).toBeFocused();
  await page.keyboard.type('wlan0');
  await expect(page.locator('#device-list')).toContainText('wlan0');
});

test('install guide never auto-runs and backs up before installing', async ({ page }) => {
  await open(page);
  const guide = page.locator('#guide-steps');
  await expect(guide).toContainText('netplan generate');
  await expect(guide).toContainText('netplan try');
  await expect(guide).toContainText(/cp -a|backup/i);
  await expect(guide).toContainText('chmod 600');
  const firstApply = (await guide.textContent())!.indexOf('netplan apply');
  const firstTry = (await guide.textContent())!.indexOf('netplan try');
  if (firstApply >= 0) expect(firstApply).toBeGreaterThan(firstTry);
});

test('layout has no horizontal overflow', async ({ page }) => {
  await open(page);
  await loadPreset(page, 'vm-host');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
