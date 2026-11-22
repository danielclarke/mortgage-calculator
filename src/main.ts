import './style.css';
import { Chart, registerables, type ChartDataset } from 'chart.js';
import { calcTax, SUPER_RATE, TAX_YEAR, type TaxResult } from './tax';
import { homeConcessionDuty, transferFee } from './duty';
import { simulate, lmiEstimate, type SimResult } from './loan';

Chart.register(...registerables);

interface FieldDef {
  id: string;
  label: string;
  value: number;
  step: number;
  prefix?: string;
  suffix?: string;
}

interface SectionDef {
  title: string;
  fields: FieldDef[];
  collapsible?: boolean;
}

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
      money('marketing', 'Marketing', 5000, 500),
    ],
  },
  {
    title: 'Buying',
    fields: [money('purchasePrice', 'Purchase price', 1100000, 5000)],
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
    title: 'Income (gross annual, incl. super)',
    fields: [
      money('incomeA', 'Person A', 100000, 1000),
      money('incomeB', 'Person B', 80000, 1000),
      { id: 'ageA', label: 'Person A age', value: 40, step: 1, suffix: 'yrs' },
      { id: 'ageB', label: 'Person B age', value: 40, step: 1, suffix: 'yrs' },
    ],
  },
  {
    title: 'Extra costs',
    collapsible: true,
    fields: [
      money('sellConveyancing', 'Conveyancing (sale)', 1500, 100),
      money('dischargeFee', 'Mortgage discharge', 400, 50),
      money('buyConveyancing', 'Conveyancing (purchase)', 2000, 100),
      money('buildingPest', 'Building & pest', 650, 50),
      money('mortgageReg', 'Mortgage registration', 248.04, 10),
      money('removalist', 'Removalist', 2500, 100),
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
  const input = Object.assign(document.createElement('input'), {
    type: 'number',
    id: def.id,
    value: String(def.value),
    step: String(def.step),
    min: '0',
  });
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
    root.append(container);
  }

  const exportBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'export', textContent: 'Copy inputs as JSON' });
  const exportOut = Object.assign(document.createElement('textarea'), { readOnly: true, className: 'export-out', hidden: true });
  exportBtn.addEventListener('click', async () => {
    const json = exportInputs();
    exportOut.value = json;
    exportOut.hidden = false;
    exportOut.select();
    try {
      await navigator.clipboard.writeText(json);
      exportBtn.textContent = 'Copied';
    } catch {
      exportBtn.textContent = 'Copy failed: select the text below';
    }
    setTimeout(() => (exportBtn.textContent = 'Copy inputs as JSON'), 2000);
  });

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

  root.append(ratesDetails, shareBtn, exportBtn, exportOut);

  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'baseRate') {
      rates = rates.map(() => num('baseRate'));
      renderRates();
    } else if (t.id === 'termYears') {
      resizeRates();
      renderRates();
    } else if (t.dataset.year) {
      rates[Number(t.dataset.year)] = Number(t.value) || 0;
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
  history.replaceState(null, '', `#${params.toString()}`);
}

function readHash(): void {
  const params = new URLSearchParams(location.hash.slice(1));
  for (const [id, el] of inputs) {
    const val = params.get(id);
    if (val !== null && val !== '' && !Number.isNaN(Number(val))) el.value = val;
  }
  const r = params.get('rates');
  rates = r ? r.split(',').map((x) => Number(x) || 0) : [];
  resizeRates();
  renderRates();
}

function exportInputs(): string {
  const values: Record<string, number> = {};
  for (const [id] of inputs) values[id] = num(id);
  return JSON.stringify({ inputs: values, ratesByYear: rates }, null, 2);
}

function num(id: string): number {
  return Number(inputs.get(id)!.value) || 0;
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
      const input = Object.assign(document.createElement('input'), { type: 'number', value: String(r), step: '0.05', min: '0' });
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
  offset: number,
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
  const netWorth = balance.map((b, i) => houseValue(price, i + 1) + offset - b);
  const horizonYears = horizon / 12;

  document.getElementById(`${key}Cards`)!.innerHTML = '<h2>Summary</h2><table class="summary">' + [
    ...extraCards,
    card('Monthly repayment', $(first), `Year 1 at ${rates[0]?.toFixed(2)}%`),
    card('Left to live on', $(netMonthly - first), `per month · net income ${$(netMonthly)}`),
    card('Repayment / gross income', grossMonthly ? fmtPct(first / grossMonthly) : '–', 'Year 1'),
    card('Total interest', $(sim.totalInterest), `without offset ${$(noOffset.totalInterest)}`),
    card('Interest saved by offset', $(noOffset.totalInterest - sim.totalInterest), `offset ${$(offset)}`),
    card('Paid off in', duration(paidOff), `term ${duration(months)}`),
    card(`Net worth, year ${Math.round(horizonYears)}`, $(netWorth[horizon - 1]), 'house + offset − loan'),
  ].join('') + '</table>';

  setChart(`${key}Monthly`, [
    series('Repayment', COLORS.payment, payment),
    series('Principal', COLORS.principal, principal),
    series('Interest', COLORS.interest, interest),
    series('Interest saved by offset', COLORS.saved, saved, { borderDash: [4, 3] }),
  ], horizonYears);

  setChart(`${key}Cumulative`, [
    series('Repayments', COLORS.payment, cumulative(payment)),
    series('Principal', COLORS.principal, cumulative(principal)),
    series('Interest', COLORS.interest, cumulative(interest)),
    series('Interest saved by offset', COLORS.saved, cumulative(saved), { borderDash: [4, 3] }),
  ], horizonYears);

  setChart(`${key}Balance`, [
    series('Loan balance', COLORS.principal, balance, { fill: 'origin' }),
    series('Loan balance (no offset)', COLORS.income, noOffset.rows.map((x) => x.balance), { borderDash: [4, 3] }),
    series('Offset', COLORS.offset, balance.map(() => offset)),
  ], horizonYears);

  setChart(`${key}Cash`, [
    series('Net household income', COLORS.income, payment.map(() => netMonthly)),
    series('Repayment', COLORS.payment, payment),
    series('Left to live on', COLORS.net, payment.map((p) => netMonthly - p), { fill: 'origin' }),
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
  const sellCosts: [string, number][] = [
    ['Agent commission', commission],
    ['Marketing', v('marketing')],
    ['Conveyancing', v('sellConveyancing')],
    ['Mortgage discharge', v('dischargeFee')],
  ];
  const sellCostTotal = sellCosts.reduce((a, [, x]) => a + x, 0);
  const netProceeds = v('salePrice') - v('payout') - sellCostTotal;
  const toOffset = Math.min(v('proceedsToOffset'), Math.max(0, netProceeds));
  const deposit = netProceeds - toOffset;

  const duty = homeConcessionDuty(v('purchasePrice'));
  const titleFee = transferFee(v('purchasePrice'));
  const buyCosts: [string, number][] = [
    ['Transfer duty (home concession)', duty],
    ['Title transfer fee', titleFee],
    ['Mortgage registration', v('mortgageReg')],
    ['Conveyancing', v('buyConveyancing')],
    ['Building & pest', v('buildingPest')],
    ['Removalist', v('removalist')],
  ];
  const buyCostTotal = buyCosts.reduce((a, [, x]) => a + x, 0);

  const baseLoan = Math.max(0, v('purchasePrice') + buyCostTotal - deposit);
  const lvr = v('purchasePrice') > 0 ? baseLoan / v('purchasePrice') : 0;
  const lmi = lmiEstimate(baseLoan, lvr);
  const loan = baseLoan + lmi.premium;
  const offset = v('currentOffset') + toOffset;
  const years = termYears();
  const months = years * 12;

  const withOffset = simulate(loan, months, rates, offset);
  const noOffset = simulate(loan, months, rates, 0);

  const taxA = calcTax(v('incomeA') / (1 + SUPER_RATE));
  const taxB = calcTax(v('incomeB') / (1 + SUPER_RATE));
  const netMonthly = (taxA.net + taxB.net) / 12;
  const grossMonthly = (taxA.gross + taxB.gross) / 12;
  const firstPayment = withOffset.rows[0]?.payment ?? 0;

  const MAX_MONTHS = 480;
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

  const headRow = (label: string, stayV: string, moveV: string, diff: string) =>
    `<tr><td>${label}</td><td>${stayV}</td><td>${moveV}</td><td>${diff}</td></tr>`;
  document.getElementById('headline')!.innerHTML = `<h2>Stay vs move</h2><table>
    <tr><th></th><th>Stay</th><th>Move</th><th>Difference</th></tr>
    ${headRow('Monthly repayment (year 1)', $(stayFirst), $(firstPayment), signed(firstPayment - stayFirst))}
    ${headRow('Left to live on per month', $(netMonthly - stayFirst), $(netMonthly - firstPayment), signed(stayFirst - firstPayment))}
    ${headRow('Debt-free', debtFreeText(stayPaidOff), debtFreeText(movePaidOff), extraMonths >= 0 ? `+${duration(extraMonths)}` : `−${duration(-extraMonths)}`)}
  </table>`;

  const warnings: string[] = [];
  if (netProceeds < 0) warnings.push('Sale proceeds are negative: payout and selling costs exceed the sale price.');
  if (lmi.premium) warnings.push(`LVR above 80%. LMI estimated at ${fmtPct(lmi.rate)} of the loan and added to the loan.`);
  if (lvr > 0.95) warnings.push('LVR above 95%. Most lenders will not lend at this LVR.');
  if (netMonthly - firstPayment < 0) warnings.push('Repayment exceeds net household income.');
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
    ]);

  document.getElementById('buyTable')!.innerHTML =
    table('Purchase', [['Purchase price', v('purchasePrice')], ...buyCosts], 'Total required') +
    table('', [
      ['Total required', v('purchasePrice') + buyCostTotal],
      ['Deposit', -deposit],
      ...(lmi.premium ? ([['LMI (est.)', lmi.premium]] as [string, number][]) : []),
    ], 'Loan amount');

  document.getElementById('incomeTable')!.innerHTML = incomeTable(taxA, taxB);

  const stayNoOffset = simulate(v('payout'), MAX_MONTHS, rates, 0, v('stayRepayment'));
  renderScenario('move', withOffset, noOffset, offset, v('purchasePrice'), months, horizon, netMonthly, grossMonthly, houseValue, [
    card('Loan amount', $(loan), `LVR ${fmtPct(lvr)}${lmi.premium ? ` · incl. LMI ${$(lmi.premium)}` : ''}`),
    subCard('Current debt', $(v('payout'))),
    subCard('Additional debt', $(loan - v('payout'))),
    card('Total moving costs', $(sellCostTotal + buyCostTotal), 'sale + purchase'),
  ]);
  renderScenario('stay', stay, stayNoOffset, v('currentOffset'), v('salePrice'), stayMonths, horizon, netMonthly, grossMonthly, houseValue, [
    card('Loan amount', $(v('payout')), `repayment ${$(v('stayRepayment'))}/mth`),
  ]);

  document.getElementById('assumptions')!.innerHTML = `<strong>Assumptions</strong><ul>
    <li>Principal &amp; interest, monthly. Repayment recalculated over the remaining term whenever the rate changes.</li>
    <li>Offset balance stays constant. Interest is charged on loan balance minus offset.</li>
    <li>QLD transfer duty uses the home concession rates (owner-occupier, not first home).</li>
    <li>Title transfer and mortgage registration fees: Titles Queensland FY2026-27 schedule.</li>
    <li>LMI is a rough estimate by LVR band. Actual premiums vary by lender and insurer.</li>
    <li>Tax: ${TAX_YEAR} resident rates, $1,000 standard deduction, LITO, 2% Medicare levy with low-income reduction. No Medicare levy surcharge, HECS/HELP or salary sacrifice.</li>
    <li>Income held constant for the life of the loan.</li>
    <li>Stay: current debt repaid at the current monthly repayment until paid off, same rate table, current offset balance. Years beyond the rate table use the last rate.</li>
    <li>Net worth = house value + offset − loan balance. House value grows at the growth rate. Selling and buying costs for any future sale are excluded. Repayments freed after payoff are not counted as savings.</li>
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
