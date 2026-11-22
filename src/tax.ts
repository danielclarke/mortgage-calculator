export const TAX_YEAR = '2026–27';
export const SUPER_RATE = 0.12;

const BRACKETS = [
  { over: 190000, base: 51370, rate: 0.45 },
  { over: 135000, base: 31020, rate: 0.37 },
  { over: 45000, base: 4020, rate: 0.3 },
  { over: 18200, base: 0, rate: 0.15 },
];

const STANDARD_DEDUCTION = 1000;
const MEDICARE_RATE = 0.02;
const MEDICARE_LOWER = 28011;

export interface TaxResult {
  gross: number;
  taxable: number;
  incomeTax: number;
  lito: number;
  medicare: number;
  totalTax: number;
  net: number;
}

function baseTax(taxable: number): number {
  for (const b of BRACKETS) {
    if (taxable > b.over) return b.base + (taxable - b.over) * b.rate;
  }
  return 0;
}

function lowIncomeOffset(taxable: number): number {
  if (taxable <= 37500) return 700;
  if (taxable <= 45000) return 700 - (taxable - 37500) * 0.05;
  if (taxable <= 66667) return Math.max(0, 325 - (taxable - 45000) * 0.015);
  return 0;
}

function medicareLevy(taxable: number): number {
  if (taxable <= MEDICARE_LOWER) return 0;
  return Math.min(taxable * MEDICARE_RATE, (taxable - MEDICARE_LOWER) * 0.1);
}

export function calcTax(gross: number): TaxResult {
  const g = Math.max(0, gross);
  const taxable = Math.max(0, g - Math.min(STANDARD_DEDUCTION, g));
  const it = baseTax(taxable);
  const lito = Math.min(it, lowIncomeOffset(taxable));
  const medicare = medicareLevy(taxable);
  const totalTax = it - lito + medicare;
  return { gross: g, taxable, incomeTax: it, lito, medicare, totalTax, net: g - totalTax };
}
