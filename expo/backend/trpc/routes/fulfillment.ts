import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/backend/trpc/create-context';
import { requireAuthUser, type SessionUser } from '@/backend/auth';
import { createAuditLog } from '@/backend/audit';
import { queryRow, queryRows, withTransaction } from '@/backend/db';

interface BookingRow {
  id: string;
  company_id: string;
  provider_company_id: string | null;
  listing_id: string | null;
  status: string;
  data: Record<string, unknown> | null;
}

interface InventoryRow {
  id: string;
  booking_id: string;
  customer_company_id: string;
  sku: string;
  description: string;
  quantity: number;
  created_at: string;
}

interface OrderRow {
  id: string;
  booking_id: string;
  customer_company_id: string;
  provider_company_id: string;
  reference: string;
  status: string;
  ship_to: string;
  notes: string;
  picked_at: string | null;
  packed_at: string | null;
  shipped_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface OrderItemRow {
  id: string;
  order_id: string;
  inventory_item_id: string;
  sku: string;
  description: string;
  quantity: number;
}

interface ShipmentRow {
  id: string;
  order_id: string;
  tracking_code: string;
  ship_to: string;
  shipped_at: string;
}

const ACTIVE_BOOKING_STATUSES = ['Accepted', 'Confirmed', 'Scheduled', 'InProgress'];

async function loadBookingForFulfillment(bookingId: string): Promise<BookingRow> {
  const rowFromColumns = await queryRow<BookingRow>(
    `SELECT id, company_id, provider_company_id, listing_id, status::text AS status, data FROM bookings WHERE id = $1 AND deleted_at IS NULL`,
    [bookingId],
  );
  if (!rowFromColumns) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Booking not found' });
  }

  if (!rowFromColumns.provider_company_id && rowFromColumns.listing_id) {
    const providerRow = await queryRow<{ company_id: string }>(
      `SELECT company_id FROM warehouse_listings WHERE id = $1`,
      [rowFromColumns.listing_id],
    );
    if (providerRow) {
      rowFromColumns.provider_company_id = providerRow.company_id;
    }
  }

  if (!rowFromColumns.provider_company_id) {
    const data = rowFromColumns.data ?? {};
    const listingIdFromData = typeof data.listingId === 'string' ? data.listingId : null;
    if (listingIdFromData) {
      const providerRow = await queryRow<{ company_id: string }>(
        `SELECT company_id FROM warehouse_listings WHERE id = $1`,
        [listingIdFromData],
      );
      if (providerRow) {
        rowFromColumns.provider_company_id = providerRow.company_id;
      }
    }
  }

  if (!rowFromColumns.company_id) {
    const data = rowFromColumns.data ?? {};
    const customerCompanyId = typeof data.customerCompanyId === 'string' ? data.customerCompanyId : null;
    if (customerCompanyId) {
      rowFromColumns.company_id = customerCompanyId;
    }
  }

  return rowFromColumns;
}

function isCustomerOf(user: SessionUser, booking: BookingRow): boolean {
  return user.companyId !== null && booking.company_id === user.companyId;
}

function isProviderOf(user: SessionUser, booking: BookingRow): boolean {
  return user.companyId !== null && booking.provider_company_id === user.companyId;
}

function requireBookingMember(user: SessionUser, booking: BookingRow): 'customer' | 'provider' {
  if (user.role === 'Admin' || user.role === 'SuperAdmin') {
    return isProviderOf(user, booking) ? 'provider' : 'customer';
  }
  if (isCustomerOf(user, booking)) {
    return 'customer';
  }
  if (isProviderOf(user, booking)) {
    return 'provider';
  }
  throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this booking' });
}

function requireActiveBooking(booking: BookingRow): void {
  const dataStatus = typeof booking.data?.status === 'string' ? (booking.data!.status as string) : null;
  const effectiveStatus = ACTIVE_BOOKING_STATUSES.includes(booking.status)
    ? booking.status
    : dataStatus && ACTIVE_BOOKING_STATUSES.includes(dataStatus)
      ? dataStatus
      : null;
  if (!effectiveStatus) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Booking must be active before fulfillment actions' });
  }
}

export const fulfillmentRouter = createTRPCRouter({
  listMyOrders: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    if (!user.companyId) {
      return { orders: [], items: [], shipments: [] };
    }
    const orders = await queryRows<OrderRow>(
      `SELECT * FROM orders
       WHERE deleted_at IS NULL
         AND (customer_company_id = $1 OR provider_company_id = $1)
       ORDER BY created_at DESC
       LIMIT 200`,
      [user.companyId],
    );
    const orderIds = orders.map((o) => o.id);
    const items = orderIds.length
      ? await queryRows<OrderItemRow>(`SELECT * FROM order_items WHERE order_id = ANY($1::text[])`, [orderIds])
      : [];
    const shipments = orderIds.length
      ? await queryRows<ShipmentRow>(`SELECT * FROM shipments WHERE order_id = ANY($1::text[])`, [orderIds])
      : [];
    return { orders, items, shipments };
  }),

  getBooking: protectedProcedure.input(z.object({ bookingId: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const booking = await loadBookingForFulfillment(input.bookingId);
    const role = requireBookingMember(user, booking);
    const inventory = await queryRows<InventoryRow>(
      `SELECT * FROM inventory_items WHERE booking_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [input.bookingId],
    );
    const orders = await queryRows<OrderRow>(
      `SELECT * FROM orders WHERE booking_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [input.bookingId],
    );
    const orderIds = orders.map((o) => o.id);
    const items = orderIds.length
      ? await queryRows<OrderItemRow>(
          `SELECT * FROM order_items WHERE order_id = ANY($1::text[])`,
          [orderIds],
        )
      : [];
    const shipments = orderIds.length
      ? await queryRows<ShipmentRow>(
          `SELECT * FROM shipments WHERE order_id = ANY($1::text[])`,
          [orderIds],
        )
      : [];
    return { booking, role, inventory, orders, orderItems: items, shipments };
  }),

  addInventory: protectedProcedure.input(z.object({
    bookingId: z.string(),
    sku: z.string().trim().min(1).max(80),
    description: z.string().trim().max(200).default(''),
    quantity: z.number().int().positive(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const booking = await loadBookingForFulfillment(input.bookingId);
    const role = requireBookingMember(user, booking);
    if (role !== 'customer') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the booking customer can add inventory' });
    }
    requireActiveBooking(booking);
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO inventory_items (id, booking_id, customer_company_id, sku, description, quantity, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, input.bookingId, booking.company_id, input.sku, input.description, input.quantity, user.id],
      );
      await createAuditLog(client, {
        actorUserId: user.id,
        companyId: booking.company_id,
        entityName: 'inventory_items',
        entityId: id,
        action: 'create',
        newValue: { sku: input.sku, quantity: input.quantity },
        requestId: ctx.requestId,
      });
    });
    return { id };
  }),

  createOrder: protectedProcedure.input(z.object({
    bookingId: z.string(),
    reference: z.string().trim().min(1).max(80),
    shipTo: z.string().trim().max(200).default(''),
    notes: z.string().trim().max(500).default(''),
    items: z.array(z.object({
      inventoryItemId: z.string(),
      quantity: z.number().int().positive(),
    })).min(1),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const booking = await loadBookingForFulfillment(input.bookingId);
    const role = requireBookingMember(user, booking);
    if (role !== 'customer') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the booking customer can create orders' });
    }
    requireActiveBooking(booking);
    if (!booking.provider_company_id) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Booking is missing provider information' });
    }

    const inventory = await queryRows<InventoryRow>(
      `SELECT * FROM inventory_items WHERE booking_id = $1 AND deleted_at IS NULL`,
      [input.bookingId],
    );
    const inventoryMap = new Map(inventory.map((i) => [i.id, i]));

    for (const item of input.items) {
      const inv = inventoryMap.get(item.inventoryItemId);
      if (!inv) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Inventory item ${item.inventoryItemId} not found on this booking` });
      }
      if (item.quantity > inv.quantity) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Requested quantity exceeds available stock for SKU ${inv.sku}` });
      }
    }

    const orderId = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO orders (id, booking_id, customer_company_id, provider_company_id, reference, status, ship_to, notes, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, 'Pending', $6, $7, $8)`,
        [orderId, input.bookingId, booking.company_id, booking.provider_company_id, input.reference, input.shipTo, input.notes, user.id],
      );
      for (const item of input.items) {
        const inv = inventoryMap.get(item.inventoryItemId)!;
        await client.query(
          `INSERT INTO order_items (id, order_id, inventory_item_id, sku, description, quantity)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [crypto.randomUUID(), orderId, inv.id, inv.sku, inv.description, item.quantity],
        );
      }
      await createAuditLog(client, {
        actorUserId: user.id,
        companyId: booking.company_id,
        entityName: 'orders',
        entityId: orderId,
        action: 'create',
        newValue: { reference: input.reference, itemCount: input.items.length },
        requestId: ctx.requestId,
      });
    });

    return { id: orderId };
  }),

  pickOrder: protectedProcedure.input(z.object({ orderId: z.string() })).mutation(async ({ ctx, input }) => {
    return transitionOrder(ctx, input.orderId, 'pick');
  }),
  packOrder: protectedProcedure.input(z.object({ orderId: z.string() })).mutation(async ({ ctx, input }) => {
    return transitionOrder(ctx, input.orderId, 'pack');
  }),
  shipOrder: protectedProcedure.input(z.object({ orderId: z.string() })).mutation(async ({ ctx, input }) => {
    return transitionOrder(ctx, input.orderId, 'ship');
  }),
  completeOrder: protectedProcedure.input(z.object({ orderId: z.string() })).mutation(async ({ ctx, input }) => {
    return transitionOrder(ctx, input.orderId, 'complete');
  }),
});

type OrderAction = 'pick' | 'pack' | 'ship' | 'complete';

const TRANSITIONS: Record<OrderAction, { from: string[]; to: string; column: string }> = {
  pick: { from: ['Pending'], to: 'Picked', column: 'picked_at' },
  pack: { from: ['Picked'], to: 'Packed', column: 'packed_at' },
  ship: { from: ['Packed'], to: 'Shipped', column: 'shipped_at' },
  complete: { from: ['Shipped'], to: 'Completed', column: 'completed_at' },
};

async function transitionOrder(ctx: { user: SessionUser | null; requestId: string }, orderId: string, action: OrderAction): Promise<{ success: true; status: string }> {
  const user = requireAuthUser(ctx.user);
  const order = await queryRow<OrderRow>(`SELECT * FROM orders WHERE id = $1 AND deleted_at IS NULL`, [orderId]);
  if (!order) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
  }
  const isProvider = user.companyId === order.provider_company_id;
  const isAdmin = user.role === 'Admin' || user.role === 'SuperAdmin';
  if (!isProvider && !isAdmin) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the warehouse provider can progress orders' });
  }
  const t = TRANSITIONS[action];
  if (!t.from.includes(order.status)) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Order is in status ${order.status}, cannot ${action}` });
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE orders SET status = $1, ${t.column} = NOW(), updated_at = NOW() WHERE id = $2`,
      [t.to, orderId],
    );

    await client.query(
      `INSERT INTO order_status_history (id, order_id, actor_user_id, previous_status, new_status, note)
       VALUES ($1, $2, $3, $4, $5, NULL)`,
      [crypto.randomUUID(), orderId, user.id, order.status, t.to],
    );

    if (action === 'pick') {
      await client.query(
        `INSERT INTO pick_tasks (id, order_id, assigned_to_user_id, status, started_at, completed_at)
         VALUES ($1, $2, $3, 'Completed', NOW(), NOW())`,
        [crypto.randomUUID(), orderId, user.id],
      );
    }

    if (action === 'pack') {
      await client.query(
        `INSERT INTO pack_tasks (id, order_id, assigned_to_user_id, status, started_at, completed_at)
         VALUES ($1, $2, $3, 'Completed', NOW(), NOW())`,
        [crypto.randomUUID(), orderId, user.id],
      );
      const fulfillmentId = crypto.randomUUID();
      await client.query(
        `INSERT INTO fulfillments (id, order_id, status) VALUES ($1, $2, 'Completed')`,
        [fulfillmentId, orderId],
      );
      const itemsResult = await client.query<{ id: string; quantity: number }>(
        `SELECT id, quantity FROM order_items WHERE order_id = $1`, [orderId],
      );
      for (const it of itemsResult.rows) {
        await client.query(
          `INSERT INTO fulfillment_items (id, fulfillment_id, order_item_id, quantity) VALUES ($1, $2, $3, $4)`,
          [crypto.randomUUID(), fulfillmentId, it.id, it.quantity],
        );
      }
    }

    if (action === 'ship') {
      const existing = await client.query<ShipmentRow>(`SELECT * FROM shipments WHERE order_id = $1`, [orderId]);
      if (existing.rowCount === 0) {
        const trackingCode = `INT-${Date.now().toString(36).toUpperCase()}-${orderId.slice(0, 4).toUpperCase()}`;
        const shipmentId = crypto.randomUUID();
        await client.query(
          `INSERT INTO shipments (id, order_id, tracking_code, ship_to) VALUES ($1, $2, $3, $4)`,
          [shipmentId, orderId, trackingCode, order.ship_to],
        );
        await client.query(
          `INSERT INTO shipping_labels (id, shipment_id, carrier, tracking_number, rate_amount, currency, raw_payload)
           VALUES ($1, $2, 'Internal'::carrier_code, $3, 0, 'cad', '{}'::jsonb)`,
          [crypto.randomUUID(), shipmentId, trackingCode],
        );
      }
    }

    await createAuditLog(client, {
      actorUserId: user.id,
      companyId: order.provider_company_id,
      entityName: 'orders',
      entityId: orderId,
      action,
      previousValue: { status: order.status },
      newValue: { status: t.to },
      requestId: ctx.requestId,
    });
  });

  return { success: true, status: t.to };
}
