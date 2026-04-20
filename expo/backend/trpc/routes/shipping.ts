import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/backend/trpc/create-context';
import { requireAuthUser } from '@/backend/auth';
import { createAuditLog } from '@/backend/audit';
import { queryRow, queryRows, withTransaction } from '@/backend/db';
import { getCarrier, listConfiguredCarriers } from '@/backend/carriers';
import type { CarrierCode } from '@/backend/carriers';

const carrierSchema = z.enum(['CanadaPost', 'Purolator', 'FedEx', 'UPS', 'Internal']);

const addressSchema = z.object({
  name: z.string().min(1).max(120),
  company: z.string().max(120).nullable().optional(),
  street1: z.string().min(1).max(200),
  street2: z.string().max(200).nullable().optional(),
  city: z.string().min(1).max(120),
  province: z.string().min(1).max(40),
  postalCode: z.string().min(3).max(12),
  country: z.string().min(2).max(2),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().nullable().optional(),
});

const parcelSchema = z.object({
  weightGrams: z.number().int().positive(),
  lengthCm: z.number().positive(),
  widthCm: z.number().positive(),
  heightCm: z.number().positive(),
  reference: z.string().max(120).nullable().optional(),
});

interface ShipmentRow {
  id: string;
  order_id: string;
  tracking_code: string;
  ship_to: string;
  shipped_at: string;
}

interface OrderRow {
  id: string;
  provider_company_id: string;
  customer_company_id: string;
  status: string;
  ship_to: string;
}

async function assertShipmentAccess(userCompanyId: string | null, role: string, shipmentId: string): Promise<{ shipment: ShipmentRow; order: OrderRow }> {
  const row = await queryRow<ShipmentRow & { provider_company_id: string; customer_company_id: string; order_status: string }>(
    `SELECT s.id, s.order_id, s.tracking_code, s.ship_to, s.shipped_at,
            o.provider_company_id, o.customer_company_id, o.status AS order_status
     FROM shipments s INNER JOIN orders o ON o.id = s.order_id
     WHERE s.id = $1`,
    [shipmentId],
  );
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Shipment not found' });
  }
  const isAdmin = role === 'Admin' || role === 'SuperAdmin';
  if (!isAdmin && userCompanyId !== row.provider_company_id && userCompanyId !== row.customer_company_id) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this shipment' });
  }
  return {
    shipment: { id: row.id, order_id: row.order_id, tracking_code: row.tracking_code, ship_to: row.ship_to, shipped_at: row.shipped_at },
    order: { id: row.order_id, provider_company_id: row.provider_company_id, customer_company_id: row.customer_company_id, status: row.order_status, ship_to: row.ship_to },
  };
}

export const shippingRouter = createTRPCRouter({
  listCarriers: protectedProcedure.query(async () => {
    const configured = listConfiguredCarriers();
    return (['CanadaPost', 'Purolator', 'FedEx', 'UPS', 'Internal'] as CarrierCode[]).map((code) => ({
      code,
      configured: configured.includes(code),
    }));
  }),

  getRates: protectedProcedure.input(z.object({
    carrier: carrierSchema,
    from: addressSchema,
    to: addressSchema,
    parcels: z.array(parcelSchema).min(1),
    serviceCode: z.string().max(40).nullable().optional(),
  })).mutation(async ({ input }) => {
    const adapter = getCarrier(input.carrier);
    if (!adapter.isConfigured()) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Carrier ${input.carrier} is not configured` });
    }
    try {
      return await adapter.getRates({
        from: input.from,
        to: input.to,
        parcels: input.parcels,
        serviceCode: input.serviceCode ?? null,
      });
    } catch (error) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error instanceof Error ? error.message : 'Rate lookup failed' });
    }
  }),

  createLabel: protectedProcedure.input(z.object({
    shipmentId: z.string(),
    carrier: carrierSchema,
    serviceCode: z.string().min(1).max(40),
    from: addressSchema,
    to: addressSchema,
    parcels: z.array(parcelSchema).min(1),
    reference: z.string().max(120).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const { shipment, order } = await assertShipmentAccess(user.companyId, user.role, input.shipmentId);
    if (user.companyId !== order.provider_company_id && user.role !== 'Admin' && user.role !== 'SuperAdmin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the warehouse provider can create labels' });
    }
    const adapter = getCarrier(input.carrier);
    if (!adapter.isConfigured()) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Carrier ${input.carrier} is not configured` });
    }
    try {
      const label = await adapter.createLabel({
        serviceCode: input.serviceCode,
        from: input.from,
        to: input.to,
        parcels: input.parcels,
        reference: input.reference ?? shipment.tracking_code,
      });
      const labelId = crypto.randomUUID();
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO shipping_labels (id, shipment_id, carrier, tracking_number, label_url, rate_amount, currency, raw_payload)
           VALUES ($1, $2, $3::carrier_code, $4, $5, $6, $7, $8::jsonb)`,
          [labelId, shipment.id, label.carrier, label.trackingNumber, label.labelUrl, label.rateAmount, label.currency, JSON.stringify(label.raw)],
        );
        if (label.trackingNumber) {
          await client.query(
            `UPDATE shipments SET tracking_code = $1 WHERE id = $2`,
            [label.trackingNumber, shipment.id],
          );
        }
        await createAuditLog(client, {
          actorUserId: user.id,
          companyId: order.provider_company_id,
          entityName: 'shipping_labels',
          entityId: labelId,
          action: 'create',
          newValue: { carrier: label.carrier, trackingNumber: label.trackingNumber, rateAmount: label.rateAmount },
          requestId: ctx.requestId,
        });
      });
      return { id: labelId, ...label };
    } catch (error) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error instanceof Error ? error.message : 'Label creation failed' });
    }
  }),

  refreshTracking: protectedProcedure.input(z.object({ shipmentId: z.string() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const { shipment } = await assertShipmentAccess(user.companyId, user.role, input.shipmentId);
    const label = await queryRow<{ carrier: CarrierCode; tracking_number: string | null }>(
      `SELECT carrier::text AS carrier, tracking_number FROM shipping_labels WHERE shipment_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [shipment.id],
    );
    const carrier: CarrierCode = (label?.carrier as CarrierCode) ?? 'Internal';
    const trackingNumber = label?.tracking_number ?? shipment.tracking_code;
    if (!trackingNumber) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No tracking number available for this shipment' });
    }
    const adapter = getCarrier(carrier);
    if (!adapter.isConfigured() && carrier !== 'Internal') {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Carrier ${carrier} is not configured` });
    }
    const tracking = await adapter.getTracking(trackingNumber);
    await withTransaction(async (client) => {
      for (const event of tracking.events) {
        await client.query(
          `INSERT INTO tracking_events (id, shipment_id, carrier, status, description, location, occurred_at)
           VALUES ($1, $2, $3::carrier_code, $4, $5, $6, $7)`,
          [crypto.randomUUID(), shipment.id, tracking.carrier, event.status, event.description, event.location, event.occurredAt],
        );
      }
    });
    return tracking;
  }),

  listTracking: protectedProcedure.input(z.object({ shipmentId: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    await assertShipmentAccess(user.companyId, user.role, input.shipmentId);
    return queryRows(
      `SELECT id, carrier::text AS carrier, status, description, location, occurred_at
       FROM tracking_events WHERE shipment_id = $1 ORDER BY occurred_at DESC`,
      [input.shipmentId],
    );
  }),
});
