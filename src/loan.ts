export interface MonthRow {
  month: number;
  rate: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

export interface SimResult {
  rows: MonthRow[];
  payoffMonth: number | null;
  totalInterest: number;
  totalPaid: number;
}

function amortPayment(principal: number, monthlyRate: number, months: number): number {
  if (months <= 0) return principal;
  if (monthlyRate === 0) return principal / months;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
}

export function simulate(principal: number, months: number, annualRates: number[], offset: number | ((month: number) => number), fixedPayment?: number): SimResult {
  const rows: MonthRow[] = [];
  let balance = principal;
  let payment = 0;
  let prevRate = NaN;
  let payoffMonth: number | null = null;
  let totalInterest = 0;
  let totalPaid = 0;

  for (let m = 0; m < months; m++) {
    const rate = annualRates[Math.floor(m / 12)] ?? annualRates[annualRates.length - 1] ?? 0;
    if (balance <= 0.005) {
      rows.push({ month: m + 1, rate, payment: 0, interest: 0, principal: 0, balance: 0 });
      continue;
    }
    const r = rate / 100 / 12;
    if (rate !== prevRate) {
      payment = fixedPayment ?? amortPayment(balance, r, months - m);
      prevRate = rate;
    }
    const interest = Math.max(0, balance - (typeof offset === 'function' ? offset(m) : offset)) * r;
    const paid = Math.min(payment, balance + interest);
    const principalPaid = paid - interest;
    balance -= principalPaid;
    totalInterest += interest;
    totalPaid += paid;
    if (balance <= 0.005) {
      balance = 0;
      payoffMonth = m + 1;
    }
    rows.push({ month: m + 1, rate, payment: paid, interest, principal: principalPaid, balance });
  }
  return { rows, payoffMonth, totalInterest, totalPaid };
}

export function lmiEstimate(loan: number, lvr: number): { rate: number; premium: number } {
  let rate = 0;
  if (lvr > 0.9) rate = 0.033;
  else if (lvr > 0.85) rate = 0.019;
  else if (lvr > 0.8) rate = 0.01;
  return { rate, premium: loan * rate };
}

export interface SideLoan {
  owed: number[];
  paid: number[];
  payoffMonth: number | null;
  totalInterest: number;
}

export function sideLoanSchedule(amount: number, annualRate: number, repay: number, months: number): SideLoan {
  const owed = [Math.max(0, amount)];
  const paid: number[] = [];
  let balance = Math.max(0, amount);
  let totalInterest = 0;
  let payoffMonth: number | null = balance <= 0 ? 0 : null;
  const r = annualRate / 100 / 12;
  for (let m = 0; m < months; m++) {
    if (balance <= 0.005) {
      paid.push(0);
      owed.push(0);
      continue;
    }
    const interest = balance * r;
    const p = Math.min(repay, balance + interest);
    balance = balance + interest - p;
    totalInterest += interest;
    if (balance <= 0.005) {
      balance = 0;
      payoffMonth ??= m + 1;
    }
    paid.push(p);
    owed.push(balance);
  }
  return { owed, paid, payoffMonth, totalInterest };
}
