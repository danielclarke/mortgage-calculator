export type Item = Record<string, string | number>;

export interface Column {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  options?: string[];
  step?: number;
  prefix?: string;
  suffix?: string;
}

export interface ListDef {
  title: string;
  columns: Column[];
  blank: () => Item;
  defaults: Item[];
}

function control(col: Column, item: Item): HTMLElement {
  if (col.type === 'select') {
    const select = document.createElement('select');
    for (const o of col.options ?? []) select.append(Object.assign(document.createElement('option'), { value: o, textContent: o }));
    select.value = String(item[col.key]);
    select.addEventListener('input', () => (item[col.key] = select.value));
    return select;
  }
  if (col.type === 'text') {
    const input = Object.assign(document.createElement('input'), { type: 'text', value: String(item[col.key]), placeholder: col.label });
    input.addEventListener('input', () => (item[col.key] = input.value));
    return input;
  }
  const wrap = document.createElement('div');
  wrap.className = 'input-wrap';
  if (col.prefix) wrap.append(Object.assign(document.createElement('span'), { textContent: col.prefix }));
  const input = Object.assign(document.createElement('input'), {
    type: 'number',
    value: String(item[col.key]),
    step: String(col.step ?? 1),
    min: '0',
  });
  input.addEventListener('input', () => (item[col.key] = Number(input.value) || 0));
  wrap.append(input);
  if (col.suffix) wrap.append(Object.assign(document.createElement('span'), { textContent: col.suffix }));
  return wrap;
}

export function listEditor(def: ListDef, items: Item[], onChange: () => void): { el: HTMLElement; redraw: () => void } {
  const el = document.createElement('div');
  el.className = 'list';
  const compact = def.columns.length === 2;

  const redraw = () => {
    el.replaceChildren(Object.assign(document.createElement('div'), { className: 'list-title', textContent: def.title }));
    items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = compact ? 'list-item compact' : 'list-item';
      const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'remove', textContent: '×', title: 'Remove' });
      remove.addEventListener('click', () => {
        items.splice(i, 1);
        redraw();
        onChange();
      });
      const [nameCol, ...rest] = def.columns;
      if (compact) {
        row.append(control(nameCol, item), control(rest[0], item), remove);
      } else {
        const head = document.createElement('div');
        head.className = 'list-head';
        head.append(control(nameCol, item), remove);
        const fields = document.createElement('div');
        fields.className = 'list-fields';
        for (const c of rest) {
          const f = document.createElement('label');
          f.append(Object.assign(document.createElement('span'), { className: 'list-label', textContent: c.label }), control(c, item));
          fields.append(f);
        }
        row.append(head, fields);
      }
      el.append(row);
    });
    const add = Object.assign(document.createElement('button'), { type: 'button', className: 'add', textContent: '+ Add' });
    add.addEventListener('click', () => {
      items.push(def.blank());
      redraw();
      onChange();
    });
    el.append(add);
  };

  redraw();
  return { el, redraw };
}

export function encodeList(def: ListDef, items: Item[]): string {
  return items.map((it) => def.columns.map((c) => encodeURIComponent(String(it[c.key]))).join(':')).join('|');
}

export function decodeList(def: ListDef, value: string): Item[] {
  if (!value) return [];
  return value.split('|').map((row) => {
    const parts = row.split(':').map((p) => decodeURIComponent(p));
    const item: Item = def.blank();
    def.columns.forEach((c, i) => {
      if (parts[i] === undefined) return;
      item[c.key] = c.type === 'number' ? Number(parts[i]) || 0 : parts[i];
    });
    return item;
  });
}
