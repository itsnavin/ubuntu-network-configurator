// Tiny DOM helpers. User-provided text is only ever set through textContent / value,
// never parsed as markup.

type Attrs = Record<string, string | number | boolean | undefined | null | EventListener>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'value' && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
      el.value = String(v);
    } else if (k === 'checked' && el instanceof HTMLInputElement) {
      el.checked = Boolean(v);
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Turns a field key such as "d-1-abc.addresses.0" into a safe id fragment. */
export function idFor(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, '_');
}

export const inputId = (key: string) => `f_${idFor(key)}`;
export const msgId = (key: string) => `m_${idFor(key)}`;
export const helpId = (key: string) => `h_${idFor(key)}`;

export type BadgeKind = 'networkd' | 'nm' | 'both' | 'advanced' | 'secret' | 'version';

export function badge(text: string, kind: BadgeKind = 'version'): HTMLElement {
  return h('span', { class: `badge badge-${kind}` }, text);
}

export interface FieldBase {
  key: string;
  label: string;
  help?: string | (Node | string)[];
  badges?: HTMLElement[];
}

function labelRow(o: FieldBase, forId: string): HTMLElement {
  return h('label', { for: forId, class: 'field-label' }, o.label, ...(o.badges ?? []));
}

function helpEl(o: FieldBase): HTMLElement | null {
  if (!o.help) return null;
  const parts = typeof o.help === 'string' ? [o.help] : o.help;
  return h('p', { class: 'help', id: helpId(o.key) }, ...parts);
}

function describedBy(o: FieldBase): string {
  return [o.help ? helpId(o.key) : '', msgId(o.key)].filter(Boolean).join(' ');
}

export function msgBox(key: string): HTMLElement {
  return h('div', { class: 'msgs', id: msgId(key), 'data-msg-for': key });
}

export interface TextOpts extends FieldBase {
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  inputmode?: string;
  type?: 'text' | 'password';
  autocomplete?: string;
  maxlength?: number;
  width?: 'narrow' | 'medium' | 'wide';
}

export function textField(o: TextOpts): HTMLElement {
  const id = inputId(o.key);
  const input = h('input', {
    id,
    type: o.type ?? 'text',
    value: o.value,
    placeholder: o.placeholder,
    inputmode: o.inputmode,
    autocomplete: o.autocomplete ?? 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    maxlength: o.maxlength,
    class: `w-${o.width ?? 'medium'}`,
    'aria-describedby': describedBy(o),
    'data-field': o.key,
    onInput: (e: Event) => o.onInput((e.target as HTMLInputElement).value),
  });
  return h('div', { class: 'field' }, labelRow(o, id), helpEl(o), input, msgBox(o.key));
}

export interface SelectOpts extends FieldBase {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}

export function selectField(o: SelectOpts): HTMLElement {
  const id = inputId(o.key);
  const sel = h(
    'select',
    { id, 'aria-describedby': describedBy(o), 'data-field': o.key, onChange: (e: Event) => o.onChange((e.target as HTMLSelectElement).value) },
    ...o.options.map(([v, l]) => h('option', { value: v, selected: v === o.value }, l)),
  );
  sel.value = o.value;
  return h('div', { class: 'field' }, labelRow(o, id), helpEl(o), sel, msgBox(o.key));
}

export interface CheckOpts extends FieldBase {
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function checkField(o: CheckOpts): HTMLElement {
  const id = inputId(o.key);
  const cb = h('input', {
    id,
    type: 'checkbox',
    checked: o.checked,
    'aria-describedby': describedBy(o),
    'data-field': o.key,
    onChange: (e: Event) => o.onChange((e.target as HTMLInputElement).checked),
  });
  return h('div', { class: 'field field-check' }, h('div', { class: 'check-row' }, cb, labelRow(o, id)), helpEl(o), msgBox(o.key));
}

export interface ListOpts extends FieldBase {
  items: string[];
  itemLabel: (i: number) => string;
  placeholder?: string;
  addLabel: string;
  inputmode?: string;
  onItem: (i: number, v: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}

/** A labelled, editable list of strings (addresses, DNS servers, ...). */
export function listField(o: ListOpts): HTMLElement {
  const rows = o.items.map((v, i) => {
    const key = `${o.key}.${i}`;
    const id = inputId(key);
    return h(
      'li',
      { class: 'list-row' },
      h('label', { for: id, class: 'visually-hidden' }, o.itemLabel(i)),
      h('input', {
        id,
        type: 'text',
        value: v,
        placeholder: o.placeholder,
        inputmode: o.inputmode,
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        class: 'w-wide',
        'aria-describedby': [o.help ? helpId(o.key) : '', msgId(key)].filter(Boolean).join(' '),
        'data-field': key,
        onInput: (e: Event) => o.onItem(i, (e.target as HTMLInputElement).value),
      }),
      h('button', { type: 'button', class: 'btn btn-small btn-ghost', id: `${id}_rm`, 'aria-label': `Remove ${o.itemLabel(i)}`, onClick: () => o.onRemove(i) }, 'Remove'),
      msgBox(key),
    );
  });
  return h(
    'fieldset',
    { class: 'field list-field' },
    h('legend', { class: 'field-label' }, o.label, ...(o.badges ?? [])),
    helpEl(o),
    rows.length ? h('ul', { class: 'list' }, ...rows) : h('p', { class: 'empty' }, 'None.'),
    h('button', { type: 'button', class: 'btn btn-small', id: `${inputId(o.key)}_add`, onClick: o.onAdd }, o.addLabel),
    msgBox(o.key),
  );
}

export function details(summary: string, open: boolean, id: string, ...children: (Child | Child[])[]): HTMLDetailsElement {
  const d = h('details', { class: 'adv', id, open }, h('summary', {}, summary), h('div', { class: 'adv-body' }, ...children));
  return d;
}

export function codeBlock(cmd: string, why: string, copy: (text: string, label: string) => void): HTMLElement {
  return h(
    'li',
    { class: 'cmd' },
    h('div', { class: 'cmd-row' }, h('code', {}, cmd), h('button', { type: 'button', class: 'btn btn-small btn-ghost', 'aria-label': `Copy command: ${cmd}`, onClick: () => copy(cmd, 'Command') }, 'Copy')),
    h('p', { class: 'help' }, why),
  );
}
