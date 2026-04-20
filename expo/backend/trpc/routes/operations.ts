import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { assertCompanyAccess, assertRole } from '@/backend/access';
import { requireAuthUser } from '@/backend/auth';
import { createAuditLog } from '@/backend/audit';
import { queryRow, queryRows, withTransaction } from '@/backend/db';
import { createTRPCRouter, protectedProcedure } from '@/backend/trpc/create-context';

interface AppointmentRow {
  id: string;
  company_id: string;
  warehouse_listing_id: string;
  scheduled_start: string;
  scheduled_end: string;
  dock_door: string | null;
  truck_plate: string | null;
  driver_name: string | null;
  appointment_type: string;
  pallet_count: number;
  status: string;
  data?: Record<string, unknown> | null;
}

interface FleetRow {
  id: string;
  company_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  user_id?: string | null;
  license_number?: string | null;
  phone?: string | null;
  unit_number?: string | null;
  plate_number?: string | null;
  trailer_number?: string | null;
  container_number?: string | null;
  container_type?: string | null;
  data: Record<string, unknown> | null;
}

type FleetEntity = 'drivers' | 'trucks' | 'trailers' | 'containers';

const fleetEntityEnum = z.enum(['drivers', 'trucks', 'trailers', 'containers']);
const fleetSearchSchema = z.object({
  entity: fleetEntityEnum,
  search: z.string().trim().optional(),
});

const fleetRecordSchema = z.object({
  name: z.string().trim().max(120).optional(),
  unitNumber: z.string().trim().max(120).optional(),
  plateNumber: z.string().trim().max(120).nullable().optional(),
  trailerNumber: z.string().trim().max(120).optional(),
  containerNumber: z.string().trim().max(120).optional(),
  containerType: z.string().trim().max(120).nullable().optional(),
  licenseNumber: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  status: z.string().trim().min(1).max(80).default('Active'),
  notes: z.string().trim().max(2000).nullable().optional(),
});

function requireFleetRole(role: string): void {
  if (!['TruckingCompany', 'Admin', 'SuperAdmin'].includes(role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Fleet access is not allowed for this role' });
  }
}

function getFleetListQuery(entity: FleetEntity): string {
  if (entity === 'drivers') {
    return `SELECT * FROM drivers WHERE company_id = $1 AND deleted_at IS NULL
      AND ($2 = '' OR COALESCE(data->>'name', '') ILIKE $3 OR COALESCE(phone, '') ILIKE $3 OR COALESCE(license_number, '') ILIKE $3)
      ORDER BY updated_at DESC`;
  }

  if (entity === 'trucks') {
    return `SELECT * FROM trucks WHERE company_id = $1 AND deleted_at IS NULL
      AND ($2 = '' OR COALESCE(unit_number, '') ILIKE $3 OR COALESCE(plate_number, '') ILIKE $3 OR COALESCE(data->>'notes', '') ILIKE $3)
      ORDER BY updated_at DESC`;
  }

  if (entity === 'trailers') {
    return `SELECT * FROM trailers WHERE company_id = $1 AND deleted_at IS NULL
      AND ($2 = '' OR COALESCE(trailer_number, '') ILIKE $3 OR COALESCE(plate_number, '') ILIKE $3 OR COALESCE(data->>'notes', '') ILIKE $3)
      ORDER BY updated_at DESC`;
  }

  return `SELECT * FROM containers WHERE company_id = $1 AND deleted_at IS NULL
    AND ($2 = '' OR COALESCE(container_number, '') ILIKE $3 OR COALESCE(container_type, '') ILIKE $3 OR COALESCE(data->>'notes', '') ILIKE $3)
    ORDER BY updated_at DESC`;
}

async function getFleetRecord(entity: FleetEntity, id: string): Promise<FleetRow | null> {
  return queryRow<FleetRow>(`SELECT * FROM ${entity} WHERE id = $1 AND deleted_at IS NULL`, [id]);
}

function buildFleetInsert(entity: FleetEntity, companyId: string, payload: z.infer<typeof fleetRecordSchema>): { sql: string; params: unknown[] } {
  const id = crypto.randomUUID();
  if (entity === 'drivers') {
    return {
      sql: `INSERT INTO drivers (id, company_id, license_number, phone, status, data)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      params: [id, companyId, payload.licenseNumber ?? null, payload.phone ?? null, payload.status, JSON.stringify({ name: payload.name ?? '', email: payload.email ?? null, notes: payload.notes ?? null })],
    };
  }

  if (entity === 'trucks') {
    return {
      sql: `INSERT INTO trucks (id, company_id, unit_number, plate_number, status, data)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      params: [id, companyId, payload.unitNumber ?? '', payload.plateNumber ?? null, payload.status, JSON.stringify({ notes: payload.notes ?? null })],
    };
  }

  if (entity === 'trailers') {
    return {
      sql: `INSERT INTO trailers (id, company_id, trailer_number, plate_number, status, data)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      params: [id, companyId, payload.trailerNumber ?? '', payload.plateNumber ?? null, payload.status, JSON.stringify({ notes: payload.notes ?? null })],
    };
  }

  return {
    sql: `INSERT INTO containers (id, company_id, container_number, container_type, status, data)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    params: [id, companyId, payload.containerNumber ?? '', payload.containerType ?? null, payload.status, JSON.stringify({ notes: payload.notes ?? null, plateNumber: payload.plateNumber ?? null })],
  };
}

function buildFleetUpdate(entity: FleetEntity, payload: z.infer<typeof fleetRecordSchema>, existing: FleetRow): { sql: string; params: unknown[] } {
  const existingData = existing.data ?? {};
  if (entity === 'drivers') {
    return {
      sql: `UPDATE drivers SET license_number = $1, phone = $2, status = $3, data = $4::jsonb, updated_at = NOW() WHERE id = $5`,
      params: [payload.licenseNumber ?? null, payload.phone ?? null, payload.status, JSON.stringify({ ...existingData, name: payload.name ?? '', email: payload.email ?? null, notes: payload.notes ?? null }), existing.id],
    };
  }

  if (entity === 'trucks') {
    return {
      sql: `UPDATE trucks SET unit_number = $1, plate_number = $2, status = $3, data = $4::jsonb, updated_at = NOW() WHERE id = $5`,
      params: [payload.unitNumber ?? '', payload.plateNumber ?? null, payload.status, JSON.stringify({ ...existingData, notes: payload.notes ?? null }), existing.id],
    };
  }

  if (entity === 'trailers') {
    return {
      sql: `UPDATE trailers SET trailer_number = $1, plate_number = $2, status = $3, data = $4::jsonb, updated_at = NOW() WHERE id = $5`,
      params: [payload.trailerNumber ?? '', payload.plateNumber ?? null, payload.status, JSON.stringify({ ...existingData, notes: payload.notes ?? null }), existing.id],
    };
  }

  return {
    sql: `UPDATE containers SET container_number = $1, container_type = $2, status = $3, data = $4::jsonb, updated_at = NOW() WHERE id = $5`,
    params: [payload.containerNumber ?? '', payload.containerType ?? null, payload.status, JSON.stringify({ ...existingData, notes: payload.notes ?? null, plateNumber: payload.plateNumber ?? null }), existing.id],
  };
}

export const operationsRouter = createTRPCRouter({
  truckingDashboard: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    assertRole(user, ['TruckingCompany', 'Admin', 'SuperAdmin']);
    const appointments = await queryRows('SELECT * FROM dock_appointments WHERE company_id = $1 AND deleted_at IS NULL ORDER BY scheduled_start ASC', [user.companyId]);
    const drivers = await queryRows('SELECT * FROM drivers WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC', [user.companyId]);
    const trucks = await queryRows('SELECT * FROM trucks WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC', [user.companyId]);
    const trailers = await queryRows('SELECT * FROM trailers WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC', [user.companyId]);
    const containers = await queryRows('SELECT * FROM containers WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC', [user.companyId]);
    return { appointments, drivers, trucks, trailers, containers };
  }),
  listFleet: protectedProcedure.input(fleetSearchSchema).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    requireFleetRole(user.role);
    assertCompanyAccess(user, user.companyId);
    const search = input.search ?? '';
    return queryRows<FleetRow>(getFleetListQuery(input.entity), [user.companyId, search, `%${search}%`]);
  }),
  getFleetRecord: protectedProcedure.input(z.object({ entity: fleetEntityEnum, id: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    requireFleetRole(user.role);
    const record = await getFleetRecord(input.entity, input.id);
    if (!record) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found' });
    }
    assertCompanyAccess(user, record.company_id);
    return record;
  }),
  createFleetRecord: protectedProcedure.input(z.object({ entity: fleetEntityEnum, payload: fleetRecordSchema })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    requireFleetRole(user.role);
    assertCompanyAccess(user, user.companyId);
    const companyId = user.companyId;
    if (!companyId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Company is required' });
    }
    if (input.entity === 'drivers' && !input.payload.name?.trim()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Driver name is required' });
    }
    if (input.entity === 'trucks' && !input.payload.unitNumber?.trim()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Truck unit number is required' });
    }
    if (input.entity === 'trailers' && !input.payload.trailerNumber?.trim()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Trailer number is required' });
    }
    if (input.entity === 'containers' && !input.payload.containerNumber?.trim()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Container number is required' });
    }
    const built = buildFleetInsert(input.entity, companyId, input.payload);
    const id = String(built.params[0]);
    await withTransaction(async (client) => {
      await client.query(built.sql, built.params);
      await createAuditLog(client, { actorUserId: user.id, companyId, entityName: input.entity, entityId: id, action: 'create', newValue: input.payload, requestId: ctx.requestId });
    });
    return { id };
  }),
  updateFleetRecord: protectedProcedure.input(z.object({ entity: fleetEntityEnum, id: z.string(), payload: fleetRecordSchema })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    requireFleetRole(user.role);
    const existing = await getFleetRecord(input.entity, input.id);
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found' });
    }
    assertCompanyAccess(user, existing.company_id);
    const built = buildFleetUpdate(input.entity, input.payload, existing);
    await withTransaction(async (client) => {
      await client.query(built.sql, built.params);
      await createAuditLog(client, { actorUserId: user.id, companyId: existing.company_id, entityName: input.entity, entityId: existing.id, action: 'update', previousValue: existing, newValue: input.payload, requestId: ctx.requestId });
    });
    return { success: true };
  }),
  archiveFleetRecord: protectedProcedure.input(z.object({ entity: fleetEntityEnum, id: z.string() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    requireFleetRole(user.role);
    const existing = await getFleetRecord(input.entity, input.id);
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found' });
    }
    assertCompanyAccess(user, existing.company_id);
    await withTransaction(async (client) => {
      await client.query(`UPDATE ${input.entity} SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [input.id]);
      await createAuditLog(client, { actorUserId: user.id, companyId: existing.company_id, entityName: input.entity, entityId: existing.id, action: 'archive', previousValue: existing, requestId: ctx.requestId });
    });
    return { success: true };
  }),
  driverJobs: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    assertRole(user, ['Driver', 'Admin', 'SuperAdmin']);
    return queryRows(
      `SELECT dock_appointments.*
       FROM dock_appointments
       WHERE deleted_at IS NULL
       AND (data->>'driverUserId' = $1 OR driver_name = $2)
       ORDER BY scheduled_start ASC`,
      [user.id, user.name],
    );
  }),
  uploadPodReference: protectedProcedure.input(z.object({ appointmentId: z.string(), fileId: z.string() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    assertRole(user, ['Driver', 'GateStaff', 'Admin', 'SuperAdmin']);
    const appointment = await queryRow<{ data: Record<string, unknown> | null; company_id: string }>('SELECT data, company_id FROM dock_appointments WHERE id = $1 AND deleted_at IS NULL', [input.appointmentId]);
    if (!appointment) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Appointment not found' });
    }
    const nextData = { ...(appointment.data ?? {}), podFileId: input.fileId };
    await withTransaction(async (client) => {
      await client.query('UPDATE dock_appointments SET data = $1::jsonb, updated_at = NOW() WHERE id = $2', [JSON.stringify(nextData), input.appointmentId]);
      await createAuditLog(client, { actorUserId: user.id, companyId: appointment.company_id, entityName: 'dock_appointments', entityId: input.appointmentId, action: 'pod_upload', newValue: { fileId: input.fileId }, requestId: ctx.requestId });
    });
    return { success: true };
  }),
  gatePanel: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    assertRole(user, ['GateStaff', 'Admin', 'SuperAdmin']);
    return queryRows<AppointmentRow>(
      `SELECT * FROM dock_appointments
       WHERE warehouse_listing_id IN (SELECT id FROM warehouse_listings WHERE company_id = $1)
       AND deleted_at IS NULL
       AND scheduled_start::date = CURRENT_DATE
       ORDER BY scheduled_start ASC`,
      [user.companyId],
    );
  }),
  checkInAppointment: protectedProcedure.input(z.object({
    appointmentId: z.string(),
    status: z.enum(['CheckedIn', 'AtGate', 'AtDoor', 'Loading', 'Unloading', 'Completed', 'NoShow']),
    driverName: z.string().max(120).nullable().optional(),
    truckPlate: z.string().max(40).nullable().optional(),
    trailerNumber: z.string().max(40).nullable().optional(),
    referenceNumber: z.string().max(80).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    assertRole(user, ['GateStaff', 'Admin', 'SuperAdmin']);
    const LIFECYCLE: Record<string, string[]> = {
      Requested: ['CheckedIn', 'AtGate', 'NoShow'],
      PendingApproval: ['Approved', 'Rejected'],
      Approved: ['CheckedIn', 'AtGate', 'NoShow'],
      CheckedIn: ['AtGate', 'AtDoor', 'NoShow'],
      AtGate: ['AtDoor', 'NoShow'],
      AtDoor: ['Loading', 'Unloading', 'Completed'],
      Loading: ['Completed'],
      Unloading: ['Completed'],
      Completed: [],
      Cancelled: [],
      NoShow: [],
    };
    await withTransaction(async (client) => {
      const current = await client.query<{ status: string; warehouse_listing_id: string }>(
        'SELECT status::text AS status, warehouse_listing_id FROM dock_appointments WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [input.appointmentId],
      );
      const row = current.rows[0];
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Appointment not found' });
      }
      const allowed = LIFECYCLE[row.status] ?? [];
      if (!allowed.includes(input.status)) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Cannot transition from ${row.status} to ${input.status}` });
      }
      await client.query('UPDATE dock_appointments SET status = $1, updated_at = NOW() WHERE id = $2', [input.status, input.appointmentId]);
      if (input.status === 'CheckedIn' || input.status === 'AtGate' || input.status === 'AtDoor') {
        await client.query(
          `INSERT INTO gate_check_ins (id, appointment_id, actor_user_id, driver_name, truck_plate, trailer_number, reference_number, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [crypto.randomUUID(), input.appointmentId, user.id, input.driverName ?? null, input.truckPlate ?? null, input.trailerNumber ?? null, input.referenceNumber ?? null, input.notes ?? null],
        );
      }
      if (input.status === 'Completed') {
        await client.query(
          `INSERT INTO gate_check_outs (id, appointment_id, actor_user_id, notes)
           VALUES ($1, $2, $3, $4)`,
          [crypto.randomUUID(), input.appointmentId, user.id, input.notes ?? null],
        );
      }
      await createAuditLog(client, { actorUserId: user.id, companyId: user.companyId, entityName: 'dock_appointments', entityId: input.appointmentId, action: 'status_update', previousValue: { status: row.status }, newValue: { status: input.status }, requestId: ctx.requestId });
    });
    return { success: true };
  }),
  createDockAppointment: protectedProcedure.input(z.object({ warehouseListingId: z.string(), bookingId: z.string().nullable().optional(), scheduledStart: z.string(), scheduledEnd: z.string(), dockDoor: z.string().nullable().optional(), truckPlate: z.string().nullable().optional(), driverName: z.string().nullable().optional(), appointmentType: z.string(), palletCount: z.number().int().nonnegative() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    if (new Date(input.scheduledEnd).getTime() <= new Date(input.scheduledStart).getTime()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Appointment end must be after start' });
    }
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      const blocked = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM dock_blocked_windows
         WHERE warehouse_listing_id = $1
         AND tstzrange(start_time, end_time, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
         AND (dock_door_id IS NULL OR dock_door_id = (SELECT id FROM dock_doors WHERE warehouse_listing_id = $1 AND code = $4 LIMIT 1))`,
        [input.warehouseListingId, input.scheduledStart, input.scheduledEnd, input.dockDoor ?? ''],
      );
      if (Number(blocked.rows[0]?.count ?? '0') > 0) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Selected time falls inside a blocked window' });
      }

      const overlapQuery = input.dockDoor
        ? await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM dock_appointments
             WHERE warehouse_listing_id = $1 AND deleted_at IS NULL
             AND dock_door = $4
             AND status NOT IN ('Cancelled', 'NoShow', 'Rejected')
             AND tstzrange(scheduled_start, scheduled_end, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
            [input.warehouseListingId, input.scheduledStart, input.scheduledEnd, input.dockDoor],
          )
        : await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM dock_appointments
             WHERE warehouse_listing_id = $1 AND deleted_at IS NULL
             AND dock_door IS NULL
             AND status NOT IN ('Cancelled', 'NoShow', 'Rejected')
             AND tstzrange(scheduled_start, scheduled_end, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
            [input.warehouseListingId, input.scheduledStart, input.scheduledEnd],
          );
      if (Number(overlapQuery.rows[0]?.count ?? '0') > 0) {
        throw new TRPCError({ code: 'CONFLICT', message: input.dockDoor ? `Dock door ${input.dockDoor} is already booked for that window` : 'Overlapping dock slot detected' });
      }

      await client.query(
        `INSERT INTO dock_appointments (id, company_id, warehouse_listing_id, booking_id, scheduled_start, scheduled_end, dock_door, truck_plate, driver_name, appointment_type, pallet_count, status, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Requested', '{}'::jsonb)`,
        [id, user.companyId, input.warehouseListingId, input.bookingId ?? null, input.scheduledStart, input.scheduledEnd, input.dockDoor ?? null, input.truckPlate ?? null, input.driverName ?? null, input.appointmentType, input.palletCount],
      );
      await createAuditLog(client, { actorUserId: user.id, companyId: user.companyId, entityName: 'dock_appointments', entityId: id, action: 'create', newValue: input, requestId: ctx.requestId });
    });
    return { id };
  }),
});
