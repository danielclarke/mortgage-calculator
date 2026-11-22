import './style.css';
import { Chart, registerables, type ChartDataset } from 'chart.js';
import { calcTax, SUPER_RATE, TAX_YEAR, type TaxResult } from './tax';
import { homeConcessionDuty, transferFee } from './duty';
import { simulate, lmiEstimate, sideLoanSchedule, amortPayment, type SimResult } from './loan';
import { numberInput, parseNum, formatNum } from './numinput';
import { listEditor, encodeList, decodeList, type Item, type ListDef } from './lists';

Chart.register(...registerables);

interface FieldDef {
  id: string;
  label: string;
  value: number;
  step: number;
  prefix?: string;
  suffix?: string;
}

type ListKey = 'sellCosts' | 'buyCosts' | 'loans';

interface SectionDef {
  title: string;
  fields: FieldDef[];
  collapsible?: boolean;
  list?: ListKey;
}

const LISTS: Record<ListKey, ListDef> = {
  sellCosts: {
    title: 'Sale costs',
    columns: [
      { key: 'name', label: 'Item', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'number', step: 100, prefix: '$' },
      { key: 'from', label: 'Paid from', type: 'select', options: ['proceeds', 'offset'] },
    ],
    blank: () => ({ name: '', amount: 0, from: 'offset' }),
    defaults: [
      { name: 'Marketing', amount: 5000, from: 'offset' },
      { name: 'Conveyancing (incl. disclosure statement)', amount: 1500, from: 'proceeds' },
      { name: 'Mortgage discharge', amount: 400, from: 'proceeds' },
      { name: 'Building & pest report', amount: 600, from: 'offset' },
    ],
  },
  buyCosts: {
    title: 'Purchase costs',
    columns: [
      { key: 'name', label: 'Item', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'number', step: 100, prefix: '$' },
      { key: 'from', label: 'Paid from', type: 'select', options: ['settlement', 'offset'] },
    ],
    blank: () => ({ name: '', amount: 0, from: 'offset' }),
    defaults: [
      { name: 'Building & pest', amount: 650, from: 'offset' },
      { name: 'Conveyancing', amount: 2000, from: 'settlement' },
      { name: 'Mortgage registration', amount: 248.04, from: 'settlement' },
      { name: 'Removalist', amount: 2500, from: 'offset' },
    ],
  },
  loans: {
    title: 'Loans',
    columns: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'number', step: 1000, prefix: '$' },
      { key: 'rate', label: 'Rate', type: 'number', step: 0.05, suffix: '%' },
      { key: 'term', label: 'Term', type: 'number', step: 1, suffix: 'yrs' },
      { key: 'into', label: 'Paid into', type: 'select', options: ['offset', 'deposit'] },
      { key: 'from', label: 'Repay from', type: 'select', options: ['offset', 'income'] },
    ],
    blank: () => ({ name: 'Loan', amount: 0, rate: 0, term: 5, into: 'offset', from: 'offset' }),
    defaults: [],
  },
};

const lists: Record<ListKey, Item[]> = {
  sellCosts: LISTS.sellCosts.defaults.map((x) => ({ ...x })),
  buyCosts: LISTS.buyCosts.defaults.map((x) => ({ ...x })),
  loans: LISTS.loans.defaults.map((x) => ({ ...x })),
};
const listRedraws: Partial<Record<ListKey, () => void>> = {};
const MAX_MONTHS = 480;

const money = (id: string, label: string, value: number, step = 1000): FieldDef => ({ id, label, value, step, prefix: '$' });
const pct = (id: string, label: string, value: number, step = 0.05): FieldDef => ({ id, label, value, step, suffix: '%' });

const SECTIONS: SectionDef[] = [
  {
    title: 'Selling',
    fields: [
      money('salePrice', 'Sale price', 900000, 5000),
      money('payout', 'Current debt', 400000, 5000),
      money('stayRepayment', 'Current monthly repayment', 3000, 50),
      pct('commissionPct', 'Agent commission (incl. GST)', 2.5, 0.1),
    ],
    list: 'sellCosts',
  },
  {
    title: 'Buying',
    fields: [money('purchasePrice', 'Purchase price', 1100000, 5000)],
    list: 'buyCosts',
  },
  {
    title: 'Offset',
    fields: [
      money('currentOffset', 'Current offset balance', 50000, 1000),
      money('proceedsToOffset', 'Sale proceeds to offset', 0, 1000),
    ],
  },
  {
    title: 'Loan',
    fields: [
      { id: 'termYears', label: 'Term', value: 30, step: 1, suffix: 'yrs' },
      pct('baseRate', 'Interest rate', 6.0),
      pct('growthPct', 'House price growth (p.a.)', 3.0, 0.1),
    ],
  },
  {
    title: 'Other loans (move only)',
    fields: [],
    list: 'loans',
  },
  {
    title: 'Income (gross salary, super on top)',
    fields: [
      money('incomeA', 'Person A', 100000, 1000),
      money('incomeB', 'Person B', 80000, 1000),
      { id: 'ageA', label: 'Person A age', value: 40, step: 1, suffix: 'yrs' },
      { id: 'ageB', label: 'Person B age', value: 40, step: 1, suffix: 'yrs' },
    ],
  },
];

const inputs = new Map<string, HTMLInputElement>();
let rates: number[] = [];
let ratesBox: HTMLDivElement;

const fmt = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const fmtPct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const $ = (v: number) => fmt.format(Math.round(v));

function inputEl(def: FieldDef): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'field';
  const label = document.createElement('label');
  label.htmlFor = def.id;
  label.textContent = def.label;
  const wrap = document.createElement('div');
  wrap.className = 'input-wrap';
  if (def.prefix) wrap.append(Object.assign(document.createElement('span'), { textContent: def.prefix }));
  const input = numberInput(def.value);
  input.id = def.id;
  wrap.append(input);
  if (def.suffix) wrap.append(Object.assign(document.createElement('span'), { textContent: def.suffix }));
  row.append(label, wrap);
  inputs.set(def.id, input);
  return row;
}

function buildInputs(): void {
  const root = document.getElementById('inputs')!;
  for (const s of SECTIONS) {
    let container: HTMLElement;
    if (s.collapsible) {
      container = document.createElement('details');
      container.append(Object.assign(document.createElement('summary'), { textContent: s.title }));
    } else {
      container = document.createElement('fieldset');
      container.append(Object.assign(document.createElement('legend'), { textContent: s.title }));
    }
    for (const f of s.fields) container.append(inputEl(f));
    if (s.list) {
      const key = s.list;
      const editor = listEditor(LISTS[key], lists[key], () => {
        update();
        writeHash();
      });
      listRedraws[key] = editor.redraw;
      container.append(editor.el);
    }
    root.append(container);
  }

  const ratesDetails = document.createElement('details');
  ratesDetails.append(Object.assign(document.createElement('summary'), { textContent: 'Interest rate by year' }));
  ratesDetails.append(
    Object.assign(document.createElement('p'), {
      className: 'note',
      textContent: 'Changing the interest rate above resets all years.',
    }),
  );
  ratesBox = document.createElement('div');
  ratesBox.className = 'rates';
  ratesDetails.append(ratesBox);
  const shareBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'export', textContent: 'Copy share link' });
  shareBtn.addEventListener('click', async () => {
    writeHash();
    try {
      await navigator.clipboard.writeText(location.href);
      shareBtn.textContent = 'Link copied';
    } catch {
      shareBtn.textContent = 'Copy failed: copy the address bar';
    }
    setTimeout(() => (shareBtn.textContent = 'Copy share link'), 2000);
  });

  root.append(ratesDetails, shareBtn);

  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'baseRate') {
      rates = rates.map(() => num('baseRate'));
      renderRates();
    } else if (t.id === 'termYears') {
      resizeRates();
      renderRates();
    } else if (t.dataset.year) {
      rates[Number(t.dataset.year)] = parseNum(t.value);
    }
    update();
    writeHash();
  });

  resizeRates();
  renderRates();
}

function writeHash(): void {
  const params = new URLSearchParams();
  for (const [id] of inputs) params.set(id, String(num(id)));
  params.set('rates', rates.join(','));
  for (const key of Object.keys(LISTS) as ListKey[]) params.set(key, encodeList(LISTS[key], lists[key]));
  history.replaceState(null, '', `#${params.toString()}`);
}

function readHash(): void {
  const params = new URLSearchParams(location.hash.slice(1));
  for (const [id, el] of inputs) {
    const val = params.get(id);
    if (val !== null && val !== '' && !Number.isNaN(Number(val))) el.value = formatNum(val);
  }
  const r = params.get('rates');
  rates = r ? r.split(',').map((x) => Number(x) || 0) : [];
  resizeRates();
  renderRates();
  for (const key of Object.keys(LISTS) as ListKey[]) {
    const val = params.get(key);
    if (val === null) continue;
    lists[key].splice(0, lists[key].length, ...decodeList(LISTS[key], val));
    listRedraws[key]?.();
  }
}

function num(id: string): number {
  return parseNum(inputs.get(id)!.value);
}

function termYears(): number {
  return Math.max(1, Math.min(40, Math.round(num('termYears'))));
}

function resizeRates(): void {
  const n = termYears();
  const fill = rates.length ? rates[rates.length - 1] : num('baseRate');
  if (rates.length > n) rates = rates.slice(0, n);
  while (rates.length < n) rates.push(fill);
}

function renderRates(): void {
  ratesBox.replaceChildren(
    ...rates.map((r, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'input-wrap';
      wrap.append(Object.assign(document.createElement('span'), { textContent: `Y${i + 1}` }));
      const input = numberInput(r);
      input.dataset.year = String(i);
      wrap.append(input);
      return wrap;
    }),
  );
}

function table(title: string, rows: [string, number][], totalLabel?: string): string {
  const body = rows.map(([l, v]) => `<tr><td>${l}</td><td>${$(v)}</td></tr>`).join('');
  const total = totalLabel ? `<tr class="total"><td>${totalLabel}</td><td>${$(rows.reduce((a, [, v]) => a + v, 0))}</td></tr>` : '';
  return `<h2>${title}</h2><table>${body}${total}</table>`;
}

function card(label: string, value: string, detail = ''): string {
  return `<tr><td>${label}</td><td>${value}</td><td class="detail">${detail}</td></tr>`;
}

function subCard(label: string, value: string, detail = ''): string {
  return card(label, value, detail).replace('<tr>', '<tr class="sub">');
}

function duration(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m ? `${y} yrs ${m} mths` : `${y} yrs`;
}

function incomeTable(a: TaxResult, b: TaxResult): string {
  const row = (l: string, f: (t: TaxResult) => number, sign = 1) =>
    `<tr><td>${l}</td><td>${$(sign * f(a))}</td><td>${$(sign * f(b))}</td></tr>`;
  return `<h2>Income (${TAX_YEAR})</h2><table>
    <tr><th></th><th>A</th><th>B</th></tr>
    ${row('Package', (t) => t.gross * (1 + SUPER_RATE))}
    ${row(`Super (${SUPER_RATE * 100}%)`, (t) => t.gross * SUPER_RATE, -1)}
    ${row('Salary', (t) => t.gross)}
    ${row('Income tax', (t) => t.incomeTax, -1)}
    ${row('Low income offset', (t) => t.lito)}
    ${row('Medicare levy', (t) => t.medicare, -1)}
    <tr class="total"><td>Net annual</td><td>${$(a.net)}</td><td>${$(b.net)}</td></tr>
    <tr><td>Net monthly</td><td>${$(a.net / 12)}</td><td>${$(b.net / 12)}</td></tr>
  </table>`;
}

const COLORS = {
  interest: '#e05a47',
  principal: '#3b82f6',
  saved: '#16a34a',
  payment: '#8b5cf6',
  offset: '#16a34a',
  net: '#f59e0b',
  income: '#64748b',
  stay: '#db2777',
};

const charts: Record<string, Chart<'line', { x: number; y: number }[]>> = {};

function makeChart(id: string): Chart<'line', { x: number; y: number }[]> {
  const style = getComputedStyle(document.documentElement);
  const grid = style.getPropertyValue('--border').trim();
  const text = style.getPropertyValue('--muted').trim();
  return new Chart(document.getElementById(id) as HTMLCanvasElement, {
    type: 'line',
    data: { datasets: [] },
    options: {
      animation: false,
      maintainAspectRatio: false,
      parsing: false,
      interaction: { mode: 'index', intersect: false },
      elements: { point: { radius: 0 }, line: { borderWidth: 2 } },
      scales: {
        x: {
          type: 'linear',
          min: 0,
          title: { display: true, text: 'Year', color: text },
          ticks: { color: text, stepSize: 1, callback: (v) => (Number(v) % 5 === 0 ? String(v) : '') },
          grid: { color: grid },
        },
        y: {
          ticks: { color: text, callback: (v) => fmt.format(Number(v)) },
          grid: { color: grid },
        },
      },
      plugins: {
        legend: { labels: { color: text, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            title: (items) => {
              const m = Math.round((items[0].parsed.x ?? 0) * 12);
              return `Year ${Math.floor(m / 12)}, month ${m % 12}`;
            },
            label: (item) => `${item.dataset.label}: ${fmt.format(item.parsed.y ?? 0)}`,
          },
        },
      },
    },
  });
}

function series(label: string, color: string, ys: number[], extra: Partial<ChartDataset<'line'>> = {}): ChartDataset<'line', { x: number; y: number }[]> {
  return {
    label,
    borderColor: color,
    backgroundColor: color + '33',
    data: ys.map((y, i) => ({ x: (i + 1) / 12, y })),
    ...extra,
  } as ChartDataset<'line', { x: number; y: number }[]>;
}

function setChart(id: string, datasets: ChartDataset<'line', { x: number; y: number }[]>[], maxX: number): void {
  const c = (charts[id] ??= makeChart(id));
  c.data.datasets = datasets;
  c.options.scales!.x!.max = maxX;
  c.update('none');
}

function cumulative(xs: number[]): number[] {
  let s = 0;
  return xs.map((x) => (s += x));
}

function pad(xs: number[], n: number, fill = 0): number[] {
  return xs.length >= n ? xs : xs.concat(Array(n - xs.length).fill(fill));
}

function renderScenario(
  key: 'move' | 'stay',
  sim: SimResult,
  noOffset: SimResult,
  offsetAt: (m: number) => number,
  owedAt: (m: number) => number,
  outgoingAt: (m: number) => number,
  sidePaidAt: (m: number) => number,
  owedTitle: string,
  price: number,
  months: number,
  horizon: number,
  netMonthly: number,
  grossMonthly: number,
  houseValue: (price: number, m: number) => number,
  extraCards: string[],
): void {
  const r = sim.rows;
  const first = r[0]?.payment ?? 0;
  const paidOff = sim.payoffMonth ?? (r[0]?.payment ? months : 0);
  const balance = pad(r.map((x) => x.balance), horizon);
  const payment = pad(r.map((x) => x.payment), horizon);
  const interest = r.map((x) => x.interest);
  const principal = r.map((x) => x.principal);
  const saved = r.map((row, i) => noOffset.rows[i].interest - row.interest);
  const netWorth = balance.map((b, i) => houseValue(price, i + 1) + offsetAt(i + 1) - owedAt(i + 1) - b);
  const horizonYears = horizon / 12;
  const outgoing = payment.map((_, i) => outgoingAt(i));
  const hasOutgoing = outgoing.some((x) => x > 0);
  const sidePaid = payment.map((_, i) => sidePaidAt(i));
  const hasSide = sidePaid.some((x) => x > 0);
  const sideOwed = payment.map((_, i) => owedAt(i + 1));

  document.getElementById(`${key}Cards`)!.innerHTML = '<h2>Summary</h2><table class="summary">' + [
    ...extraCards,
    card('Monthly repayment', $(first), `Year 1 at ${rates[0]?.toFixed(2)}%`),
    card('Left to live on', $(netMonthly - first - outgoing[0]), `per month · net income ${$(netMonthly)}${outgoing[0] ? ` · other loans ${$(outgoing[0])}` : ''}`),
    card('Repayment / gross income', grossMonthly ? fmtPct(first / grossMonthly) : '–', 'Year 1'),
    card('Total interest', $(sim.totalInterest), `without offset ${$(noOffset.totalInterest)}`),
    card('Interest saved by offset', $(noOffset.totalInterest - sim.totalInterest), `offset ${$(offsetAt(0))}`),
    card('Paid off in', duration(paidOff), `term ${duration(months)}`),
    card(`Net worth, year ${Math.round(horizonYears)}`, $(netWorth[horizon - 1]), 'house + offset − loans'),
  ].join('') + '</table>';

  setChart(`${key}Monthly`, [
    series('Repayment', COLORS.payment, payment),
    series('Principal', COLORS.principal, principal),
    series('Interest', COLORS.interest, interest),
    series('Interest saved by offset', COLORS.saved, saved, { borderDash: [4, 3] }),
    ...(hasSide ? [series(owedTitle, COLORS.net, sidePaid)] : []),
  ], horizonYears);

  setChart(`${key}Cumulative`, [
    series('Repayments', COLORS.payment, cumulative(payment)),
    series('Principal', COLORS.principal, cumulative(principal)),
    series('Interest', COLORS.interest, cumulative(interest)),
    series('Interest saved by offset', COLORS.saved, cumulative(saved), { borderDash: [4, 3] }),
    ...(hasSide ? [series(owedTitle, COLORS.net, cumulative(sidePaid))] : []),
  ], horizonYears);

  setChart(`${key}Balance`, [
    series('Loan balance', COLORS.principal, balance, { fill: 'origin' }),
    series('Loan balance (no offset)', COLORS.income, noOffset.rows.map((x) => x.balance), { borderDash: [4, 3] }),
    series('Offset', COLORS.offset, balance.map((_, i) => offsetAt(i + 1))),
    ...(hasSide ? [series('Other loans owed', COLORS.net, sideOwed)] : []),
  ], horizonYears);

  setChart(`${key}Cash`, [
    series('Net household income', COLORS.income, payment.map(() => netMonthly)),
    series('Repayment', COLORS.payment, payment),
    ...(hasOutgoing ? [series('Other loan repayments', COLORS.interest, outgoing)] : []),
    series('Left to live on', COLORS.net, payment.map((p, i) => netMonthly - p - outgoing[i]), { fill: 'origin' }),
  ], horizonYears);

  setChart(`${key}NetWorth`, [series('Net worth', COLORS.principal, netWorth)], horizonYears);
}

function buildTabs(): void {
  const charts_: [string, string][] = [
    ['Monthly', 'Monthly'],
    ['Cumulative', 'Cumulative'],
    ['Balance', 'Balances'],
    ['Cash', 'Monthly cash flow'],
    ['NetWorth', 'Net worth'],
  ];
  for (const key of ['move', 'stay']) {
    const panel = document.getElementById(`tab-${key}`)!;
    panel.innerHTML =
      `<div class="tables"><div id="${key}Cards"></div>` +
      (key === 'move' ? '<div id="sellTable"></div><div id="buyTable"></div>' : '') +
      '</div>' +
      charts_.map(([id, title]) => `<div class="chart"><h2>${title}</h2><canvas id="${key}${id}"></canvas></div>`).join('');
  }
  const buttons = document.querySelectorAll<HTMLButtonElement>('.tabs button');
  buttons.forEach((b) =>
    b.addEventListener('click', () => {
      const key = b.dataset.tab!;
      buttons.forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll<HTMLElement>('.tab-panel').forEach((p) => (p.hidden = p.id !== `tab-${key}`));
      for (const [id, c] of Object.entries(charts)) if (id.startsWith(key)) c.resize();
    }),
  );
}

function update(): void {
  const v = (id: string) => num(id);

  const commission = (v('salePrice') * v('commissionPct')) / 100;
  const named = (it: Item): [string, number] => [String(it.name), Number(it.amount)];
  const total = (xs: [string, number][]) => xs.reduce((a, [, x]) => a + x, 0);
  const sellCosts: [string, number][] = [
    ['Agent commission', commission],
    ...lists.sellCosts.filter((it) => it.from !== 'offset').map(named),
  ];
  const sellOffsetCosts = lists.sellCosts.filter((it) => it.from === 'offset').map(named);
  const sellCostTotal = total(sellCosts) + total(sellOffsetCosts);
  const netProceeds = v('salePrice') - v('payout') - total(sellCosts);
  const toOffset = Math.min(v('proceedsToOffset'), Math.max(0, netProceeds));
  const deposit = netProceeds - toOffset;

  const duty = homeConcessionDuty(v('purchasePrice'));
  const titleFee = transferFee(v('purchasePrice'));
  const buyCosts: [string, number][] = [
    ['Transfer duty (home concession)', duty],
    ['Title transfer fee', titleFee],
    ...lists.buyCosts.filter((it) => it.from !== 'offset').map(named),
  ];
  const buyOffsetCosts = lists.buyCosts.filter((it) => it.from === 'offset').map(named);
  const settlementCosts = total(buyCosts);
  const buyCostTotal = settlementCosts + total(buyOffsetCosts);
  const offsetCosts = total(sellOffsetCosts) + total(buyOffsetCosts);

  const depositLoans = lists.loans
    .filter((l) => l.into === 'deposit' && Number(l.amount) > 0)
    .map((l): [string, number] => [String(l.name) || 'Loan', Number(l.amount)]);
  const loanDeposit = depositLoans.reduce((a, [, x]) => a + x, 0);
  const baseLoan = Math.max(0, v('purchasePrice') + settlementCosts - deposit - loanDeposit);
  const lvr = v('purchasePrice') > 0 ? baseLoan / v('purchasePrice') : 0;
  const lmi = lmiEstimate(baseLoan, lvr);
  const loan = baseLoan + lmi.premium;
  const baseOffset = v('currentOffset') + toOffset - offsetCosts;
  const sideLoans = lists.loans.map((l) => {
    const termMonths = Math.max(1, Math.min(MAX_MONTHS, Math.round(Number(l.term) * 12)));
    const repay = amortPayment(Number(l.amount), Number(l.rate) / 100 / 12, termMonths);
    return {
      name: String(l.name) || 'Loan',
      amount: Number(l.amount),
      rate: Number(l.rate),
      repay,
      intoOffset: l.into !== 'deposit',
      fromOffset: l.from !== 'income',
      sched: sideLoanSchedule(Number(l.amount), Number(l.rate), repay, MAX_MONTHS),
    };
  });
  const offsetArr: number[] = [];
  const owedArr: number[] = [];
  const outArr: number[] = [];
  const sidePaidArr: number[] = [];
  const cumPaid = sideLoans.map(() => 0);
  for (let m = 0; m <= MAX_MONTHS; m++) {
    let off = baseOffset;
    let owed = 0;
    let out = 0;
    let sidePaid = 0;
    sideLoans.forEach((l, i) => {
      off += (l.intoOffset ? l.amount : 0) - (l.fromOffset ? cumPaid[i] : 0);
      owed += l.sched.owed[m] ?? 0;
      const p = l.sched.paid[m] ?? 0;
      if (!l.fromOffset) out += p;
      sidePaid += p;
      cumPaid[i] += p;
    });
    offsetArr.push(Math.max(0, off));
    owedArr.push(owed);
    outArr.push(out);
    sidePaidArr.push(sidePaid);
  }
  const at = (arr: number[]) => (m: number) => arr[Math.min(m, arr.length - 1)];
  const offsetAt = at(offsetArr);
  const owedAt = at(owedArr);
  const outgoingAt = at(outArr);
  const sidePaidAt = at(sidePaidArr);
  const years = termYears();
  const months = years * 12;

  const withOffset = simulate(loan, months, rates, offsetAt);
  const noOffset = simulate(loan, months, rates, 0);

  const taxA = calcTax(v('incomeA'));
  const taxB = calcTax(v('incomeB'));
  const netMonthly = (taxA.net + taxB.net) / 12;
  const grossMonthly = (taxA.gross + taxB.gross) / 12;
  const firstPayment = withOffset.rows[0]?.payment ?? 0;

  const stayFull = simulate(v('payout'), MAX_MONTHS, rates, v('currentOffset'), v('stayRepayment'));
  const stayMonths = Math.max(1, stayFull.payoffMonth ?? MAX_MONTHS);
  const stay = { ...stayFull, rows: stayFull.rows.slice(0, stayMonths) };
  const stayFirst = stay.rows[0]?.payment ?? 0;
  const movePaidOff = loan > 0 ? withOffset.payoffMonth ?? months : 0;
  const stayPaidOff = v('payout') > 0 ? stay.payoffMonth ?? stayMonths : 0;
  const horizon = Math.max(months, stayMonths);
  const thisYear = new Date().getFullYear();
  const debtFreeText = (m: number) =>
    `${Math.floor(thisYear + m / 12)} (A ${Math.floor(v('ageA') + m / 12)} · B ${Math.floor(v('ageB') + m / 12)})`;
  const extraMonths = movePaidOff - stayPaidOff;
  const growth = v('growthPct') / 100;
  const houseValue = (price: number, m: number) => price * Math.pow(1 + growth, m / 12);
  const signed = (x: number) => (x > 0 ? '+' : x < 0 ? '−' : '') + $(Math.abs(x));

  const moveLeft = netMonthly - firstPayment - outgoingAt(0);
  const shortfall = netMonthly - stayFirst - moveLeft;
  const netOf = (salary: number) => calcTax(salary).net;
  const extraSalary = (base: number, extraNetAnnual: number) => {
    const target = netOf(base) + extraNetAnnual;
    let lo = 0;
    let hi = extraNetAnnual * 3 + 1000;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (netOf(base + mid) < target) lo = mid;
      else hi = mid;
    }
    return hi;
  };
  const extraIncomeText =
    shortfall > 0
      ? `${$(shortfall)}/mth net · salary +${$(extraSalary(v('incomeA'), shortfall * 12))}/yr (A) or +${$(extraSalary(v('incomeB'), shortfall * 12))}/yr (B)`
      : 'None: moving leaves the same or more';
  const headRow = (label: string, stayV: string, moveV: string, diff: string) =>
    `<tr><td>${label}</td><td>${stayV}</td><td>${moveV}</td><td>${diff}</td></tr>`;
  document.getElementById('headline')!.innerHTML = `<h2>Stay vs move</h2><table>
    <tr><th></th><th>Stay</th><th>Move</th><th>Difference</th></tr>
    ${headRow('Monthly repayment (year 1)', $(stayFirst), $(firstPayment), signed(firstPayment - stayFirst))}
    ${headRow('Left to live on per month', $(netMonthly - stayFirst), $(moveLeft), signed(moveLeft - (netMonthly - stayFirst)))}
    <tr><td>Extra income to match stay (year 1)</td><td colspan="3">${extraIncomeText}</td></tr>
    ${headRow('Debt-free', debtFreeText(stayPaidOff), debtFreeText(movePaidOff), extraMonths >= 0 ? `+${duration(extraMonths)}` : `−${duration(-extraMonths)}`)}
  </table>`;

  const warnings: string[] = [];
  if (netProceeds < 0) warnings.push('Sale proceeds are negative: payout and selling costs exceed the sale price.');
  if (lmi.premium) warnings.push(`LVR above 80%. LMI estimated at ${fmtPct(lmi.rate)} of the loan and added to the loan.`);
  if (lvr > 0.95) warnings.push('LVR above 95%. Most lenders will not lend at this LVR.');
  if (baseOffset < 0) warnings.push(`Costs paid from the offset exceed the available offset by ${$(-baseOffset)}.`);
  if (moveLeft < 0) warnings.push('Repayments exceed net household income.');
  for (const l of sideLoans) if (l.amount > 0 && l.sched.payoffMonth === null) warnings.push(`${l.name} is not repaid within 40 years at ${$(l.repay)}/mth.`);
  if (v('payout') > 0 && stayFull.payoffMonth === null) warnings.push('Current repayment does not pay off the current debt within 40 years.');
  document.getElementById('warnings')!.innerHTML = warnings.map((w) => `<div class="warn">${w}</div>`).join('');

  document.getElementById('sellTable')!.innerHTML =
    table('Sale', [
      ['Sale price', v('salePrice')],
      ['Current debt', -v('payout')],
      ...sellCosts.map(([l, x]): [string, number] => [l, -x]),
    ], 'Net proceeds') +
    table('', [
      ['To offset', toOffset],
      ['To deposit', deposit],
    ]) +
    (sellOffsetCosts.length ? table('Paid from offset', sellOffsetCosts, 'Total') : '');

  document.getElementById('buyTable')!.innerHTML =
    table('Purchase', [['Purchase price', v('purchasePrice')], ...buyCosts], 'Total required') +
    table('', [
      ['Total required', v('purchasePrice') + settlementCosts],
      ['Deposit', -deposit],
      ...depositLoans.map(([n, x]): [string, number] => [n, -x]),
      ...(lmi.premium ? ([['LMI (est.)', lmi.premium]] as [string, number][]) : []),
    ], 'Loan amount') +
    (buyOffsetCosts.length ? table('Paid from offset', buyOffsetCosts, 'Total') : '');

  document.getElementById('incomeTable')!.innerHTML = incomeTable(taxA, taxB);

  const stayNoOffset = simulate(v('payout'), MAX_MONTHS, rates, 0, v('stayRepayment'));
  renderScenario('move', withOffset, noOffset, offsetAt, owedAt, outgoingAt, sidePaidAt, 'Other loan repayments', v('purchasePrice'), months, horizon, netMonthly, grossMonthly, houseValue, [
    card('Loan amount', $(loan), `LVR ${fmtPct(lvr)}${lmi.premium ? ` · incl. LMI ${$(lmi.premium)}` : ''}`),
    subCard('Current debt', $(v('payout'))),
    subCard('Additional debt', $(loan - v('payout'))),
    card('Offset at settlement', $(offsetAt(0))),
    subCard('Current offset', $(v('currentOffset'))),
    ...(toOffset ? [subCard('Sale proceeds', $(toOffset))] : []),
    ...sideLoans.filter((l) => l.intoOffset && l.amount > 0).map((l) => subCard(l.name, $(l.amount))),
    ...(offsetCosts ? [subCard('Costs paid from offset', $(-offsetCosts))] : []),
    card('Total moving costs', $(sellCostTotal + buyCostTotal), 'sale + purchase'),
    ...sideLoans
      .filter((l) => l.amount > 0)
      .map((l) =>
        card(
          l.name,
          $(l.amount),
          `into ${l.intoOffset ? 'offset' : 'deposit'} · ${$(l.repay)}/mth from ${l.fromOffset ? 'offset' : 'income'} · ${l.sched.payoffMonth !== null ? `repaid in ${duration(l.sched.payoffMonth)}` : 'not repaid'}${l.sched.totalInterest > 0 ? ` · interest ${$(l.sched.totalInterest)}` : ''}`,
        ),
      ),
  ]);
  renderScenario('stay', stay, stayNoOffset, () => v('currentOffset'), () => 0, () => 0, () => 0, '', v('salePrice'), stayMonths, horizon, netMonthly, grossMonthly, houseValue, [
    card('Loan amount', $(v('payout')), `repayment ${$(v('stayRepayment'))}/mth`),
  ]);

  document.getElementById('assumptions')!.innerHTML = `<strong>Assumptions</strong><ul>
    <li>Principal &amp; interest, monthly. Repayment recalculated over the remaining term whenever the rate changes.</li>
    <li>Offset balance stays constant, except for other loans. Interest is charged on loan balance minus offset.</li>
    <li>Each cost is paid either from the offset (reduces the starting offset) or from sale proceeds / at settlement (reduces the deposit or adds to the loan). Agent commission is paid from proceeds; duty and title fee at settlement.</li>
    <li>Other loans (move only): paid into the offset or the deposit at settlement. A deposit loan reduces the bank loan, LVR and LMI. Repaid principal &amp; interest over the loan's term in fixed monthly amounts, either from the offset (offset falls) or from income (reduces money left to live on). Interest at the loan's rate is added monthly.</li>
    <li>QLD transfer duty uses the home concession rates (owner-occupier, not first home).</li>
    <li>Title transfer and mortgage registration fees: Titles Queensland FY2026-27 schedule.</li>
    <li>LMI is a rough estimate by LVR band. Actual premiums vary by lender and insurer.</li>
    <li>Tax: ${TAX_YEAR} resident rates, $1,000 standard deduction, LITO, 2% Medicare levy with low-income reduction. No Medicare levy surcharge, HECS/HELP or salary sacrifice.</li>
    <li>Income held constant for the life of the loan.</li>
    <li>Stay: current debt repaid at the current monthly repayment until paid off, same rate table, current offset balance. Years beyond the rate table use the last rate.</li>
    <li>Net worth = house value + offset − loan balance − other loans owed. House value grows at the growth rate. Selling and buying costs for any future sale are excluded. Repayments freed after payoff are not counted as savings.</li>
  </ul>
  <strong>Sources</strong><ul>
    <li><a href="https://qro.qld.gov.au/duties/transfer-duty/calculate/concession-rates/" target="_blank" rel="noopener">QRO: transfer duty home concession rates</a></li>
    <li><a href="https://www.titlesqld.com.au/wp-content/uploads/2026/05/Titles-Registry-Fees_FY-2026-to-2027.pdf" target="_blank" rel="noopener">Titles Queensland: FY2026-27 registry fees (PDF)</a></li>
    <li><a href="https://ato.gov.au/about-ato/new-legislation/in-detail/individuals/personal-income-tax-new-tax-cuts-for-every-Australian-taxpayer" target="_blank" rel="noopener">ATO: personal income tax rates (tax cuts)</a></li>
    <li><a href="https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/deductions-you-can-claim/claiming-deductions" target="_blank" rel="noopener">ATO: claiming deductions ($1,000 standard deduction)</a></li>
    <li><a href="https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/tax-offsets/low-income-tax-offset" target="_blank" rel="noopener">ATO: low income tax offset</a></li>
    <li><a href="https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners" target="_blank" rel="noopener">ATO: Medicare levy reduction for low income earners</a></li>
    <li>No source: agent commission, marketing, conveyancing, mortgage discharge, building &amp; pest, removalist, LMI and house price growth defaults are typical-range estimates.</li>
  </ul>`;
}

buildInputs();
readHash();
buildTabs();
update();
