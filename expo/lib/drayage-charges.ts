/**
 * Per diem / demurrage / storage accrual math for drayage orders.
 * A charge starts accruing the day AFTER the last free day (LFD). Amount is
 * whole overdue days × the daily rate. Urgency drives the countdown colour.
 */
export type ChargeKind = 'perDiem' | 'demurrage' | 'storage';

export interface ChargeInput {
  lastFreeDay?: string | null;
  dailyRate?: number | null;
  freeDays?: number | null;
}

export interface ChargeResult {
  kind: ChargeKind;
  label: string;
  lastFreeDay: string | null;
  dailyRate: number;
  daysLeft: number | null;   // >0 within free window, 0 = today is LFD, <0 overdue
  overdueDays: number;       // whole days past LFD (0 when not overdue)
  amount: number;            // overdueDays × dailyRate
  urgency: 'none' | 'ok' | 'soon' | 'over';
}

const KIND_LABEL: Record<ChargeKind, string> = {
  perDiem: 'Per diem',
  demurrage: 'Demurrage',
  storage: 'Storage',
};

const startOfDay = (d: Date): number => {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
};

/** Whole days from today until the given date (negative when in the past). */
export function daysUntilDate(dateStr?: string | null): number | null {
  const s = (dateStr ?? '').trim();
  if (!s) return null;
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((startOfDay(new Date(t)) - startOfDay(new Date())) / 86_400_000);
}

export function computeCharge(kind: ChargeKind, input: ChargeInput): ChargeResult {
  const dailyRate = Number(input.dailyRate ?? 0) || 0;
  const lastFreeDay = (input.lastFreeDay ?? '').trim() || null;
  const daysLeft = daysUntilDate(lastFreeDay);
  const overdueDays = daysLeft != null && daysLeft < 0 ? -daysLeft : 0;
  const amount = Math.round(overdueDays * dailyRate * 100) / 100;
  let urgency: ChargeResult['urgency'] = 'none';
  if (daysLeft != null) {
    if (daysLeft < 0) urgency = 'over';
    else if (daysLeft <= 2) urgency = 'soon';
    else urgency = 'ok';
  }
  return {
    kind,
    label: KIND_LABEL[kind],
    lastFreeDay,
    dailyRate,
    daysLeft,
    overdueDays,
    amount,
    urgency,
  };
}

/** All three accessorial charges for an order row. */
export function orderCharges(order: {
  per_diem_last_free_day?: string | null; per_diem_daily_rate?: number | null; per_diem_free_days?: number | null;
  demurrage_last_free_day?: string | null; demurrage_daily_rate?: number | null; demurrage_free_days?: number | null;
  storage_last_free_day?: string | null; storage_daily_rate?: number | null; storage_free_days?: number | null;
}): ChargeResult[] {
  return [
    computeCharge('perDiem', { lastFreeDay: order.per_diem_last_free_day, dailyRate: order.per_diem_daily_rate, freeDays: order.per_diem_free_days }),
    computeCharge('demurrage', { lastFreeDay: order.demurrage_last_free_day, dailyRate: order.demurrage_daily_rate, freeDays: order.demurrage_free_days }),
    computeCharge('storage', { lastFreeDay: order.storage_last_free_day, dailyRate: order.storage_daily_rate, freeDays: order.storage_free_days }),
  ];
}

export const totalAccessorials = (charges: ChargeResult[]): number =>
  Math.round(charges.reduce((s, c) => s + c.amount, 0) * 100) / 100;

/** A short countdown chip label, e.g. "Per diem: 2d left" or "Demurrage: 3d over · $450". */
export function chargeChipLabel(c: ChargeResult): string {
  if (!c.lastFreeDay) return `${c.label}: not set`;
  if (c.daysLeft == null) return `${c.label}`;
  if (c.daysLeft > 0) return `${c.label}: ${c.daysLeft}d left`;
  if (c.daysLeft === 0) return `${c.label}: LFD today`;
  return `${c.label}: ${c.overdueDays}d over${c.amount > 0 ? ` · $${c.amount}` : ''}`;
}
