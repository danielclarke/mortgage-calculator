function per100(amount: number, rate: number): number {
  return Math.ceil(amount / 100) * rate;
}

export function homeConcessionDuty(value: number): number {
  const v = Math.max(0, value);
  if (v <= 350000) return per100(v, 1);
  if (v <= 540000) return 3500 + per100(v - 350000, 3.5);
  if (v <= 1000000) return 10150 + per100(v - 540000, 4.5);
  return 30850 + per100(v - 1000000, 5.75);
}

const TRANSFER_BASE = 248.04;
const TRANSFER_THRESHOLD = 180000;
const TRANSFER_PER_10K = 46.56;

export function transferFee(value: number): number {
  const over = Math.max(0, value - TRANSFER_THRESHOLD);
  return TRANSFER_BASE + Math.ceil(over / 10000) * TRANSFER_PER_10K;
}
