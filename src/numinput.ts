export function parseNum(s: string): number {
  return Number(s.replace(/,/g, '')) || 0;
}

export function formatNum(s: string): string {
  const clean = s.replace(/[^0-9.]/g, '');
  const [int, ...dec] = clean.split('.');
  const intFmt = int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec.length ? `${intFmt}.${dec.join('')}` : intFmt;
}

export function numberInput(value: number | string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.value = formatNum(String(value));
  input.addEventListener('input', () => {
    const caret = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, caret).replace(/[^0-9.]/g, '').length;
    input.value = formatNum(input.value);
    let pos = 0;
    let seen = 0;
    while (pos < input.value.length && seen < before) {
      if (/[0-9.]/.test(input.value[pos])) seen++;
      pos++;
    }
    input.setSelectionRange(pos, pos);
  });
  return input;
}
