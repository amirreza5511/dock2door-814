import type { PoolClient } from 'pg';
import { queryRow } from '@/backend/db';

const DEFAULT_COMMISSION: Record<string, number> = {
  warehouse: 8,
  service: 20,
  labour: 15,
  fulfillment: 10,
  default: 8,
};

export async function getCommissionPercentage(module: string): Promise<number> {
  const row = await queryRow<{ percentage: string }>(
    `SELECT percentage::text AS percentage FROM commission_rules
     WHERE module = $1 AND active = TRUE ORDER BY updated_at DESC LIMIT 1`,
    [module],
  );
  if (row) {
    const pct = Number(row.percentage);
    if (!Number.isNaN(pct)) {
      return pct;
    }
  }
  return DEFAULT_COMMISSION[module] ?? DEFAULT_COMMISSION.default;
}

export function computeCommission(grossAmount: number, percentage: number): { commission: number; net: number } {
  const commission = Number((grossAmount * (percentage / 100)).toFixed(2));
  const net = Number((grossAmount - commission).toFixed(2));
  return { commission, net };
}

export async function recordProviderEarning(
  client: PoolClient,
  params: {
    paymentId: string;
    providerCompanyId: string | null;
    netAmount: number;
    currency: string;
  },
): Promise<string | null> {
  if (!params.providerCompanyId || params.netAmount <= 0) {
    return null;
  }
  const id = crypto.randomUUID();
  await client.query(
    `INSERT INTO provider_earnings (id, company_id, payment_id, amount, currency, status)
     VALUES ($1, $2, $3, $4, $5, 'Pending')
     ON CONFLICT DO NOTHING`,
    [id, params.providerCompanyId, params.paymentId, params.netAmount, params.currency],
  );
  return id;
}

export async function getModuleForPayment(paymentId: string): Promise<string> {
  const row = await queryRow<{ booking_type: string | null }>(
    `SELECT COALESCE(b.data->>'bookingType', 'warehouse') AS booking_type
     FROM payments p
     LEFT JOIN bookings b ON b.id = p.booking_id
     WHERE p.id = $1`,
    [paymentId],
  );
  const t = (row?.booking_type ?? 'warehouse').toLowerCase();
  if (t.includes('service')) return 'service';
  if (t.includes('labour') || t.includes('labor')) return 'labour';
  if (t.includes('fulfill')) return 'fulfillment';
  return 'warehouse';
}
