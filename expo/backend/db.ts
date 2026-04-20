import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { env } from '@/backend/env';
import { createExtendedSchema } from '@/backend/schema-extensions';
import { createLabourSchema } from '@/backend/schema-labour';
import { createWmsSchema } from '@/backend/schema-wms';
import { createOpsSchema } from '@/backend/schema-ops';
import { seedDemoAccounts } from '@/backend/seed';

const globalForDb = globalThis as typeof globalThis & {
  __dock2doorPool?: Pool;
  __dock2doorSchemaReady?: Promise<void>;
};

export const db = globalForDb.__dock2doorPool ?? new Pool({
  connectionString: env.databaseUrl,
  ssl: env.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

globalForDb.__dock2doorPool = db;

async function createEnums(): Promise<void> {
  await db.query(`
    DO $$ BEGIN
      CREATE TYPE user_role AS ENUM ('Customer', 'WarehouseProvider', 'ServiceProvider', 'Employer', 'Worker', 'TruckingCompany', 'Driver', 'GateStaff', 'Admin', 'SuperAdmin');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE company_type AS ENUM ('Customer', 'WarehouseProvider', 'ServiceProvider', 'Employer', 'TruckingCompany');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE company_status AS ENUM ('PendingApproval', 'Approved', 'Suspended');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE user_status AS ENUM ('PendingVerification', 'Active', 'Suspended');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE listing_status AS ENUM ('Draft', 'PendingApproval', 'Available', 'Hidden', 'Suspended', 'Archived');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE booking_status AS ENUM ('Draft', 'Requested', 'PendingReview', 'Quoted', 'CounterOffered', 'Approved', 'Rejected', 'Confirmed', 'Scheduled', 'InProgress', 'Completed', 'Cancelled', 'Disputed', 'Refunded', 'Closed');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE appointment_status AS ENUM ('Requested', 'PendingApproval', 'Approved', 'Rejected', 'Rescheduled', 'CheckedIn', 'AtGate', 'AtDoor', 'Loading', 'Unloading', 'Completed', 'Cancelled', 'NoShow', 'Delayed');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE payment_status AS ENUM ('Pending', 'Paid', 'Failed', 'Cancelled', 'Refunded');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE invoice_status AS ENUM ('Draft', 'Issued', 'Paid', 'Void');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE message_scope AS ENUM ('Booking', 'Appointment', 'Dispute', 'Direct', 'Internal');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE file_kind AS ENUM ('POD', 'Document', 'Attachment', 'WarehousePhoto', 'Invoice', 'Certification');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
}

async function createCoreTables(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type company_type NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      province TEXT,
      postal_code TEXT,
      country TEXT DEFAULT 'Canada',
      status company_status NOT NULL DEFAULT 'PendingApproval',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role user_role NOT NULL,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      status user_status NOT NULL DEFAULT 'PendingVerification',
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      profile_image TEXT NULL,
      last_login_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS company_members (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_role TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL,
      UNIQUE(company_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      rotated_at TIMESTAMPTZ NULL,
      revoked_at TIMESTAMPTZ NULL,
      replaced_by_token_id TEXT NULL,
      user_agent TEXT NULL,
      ip_address TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS warehouse_listings (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      owner_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      warehouse_type TEXT NOT NULL,
      available_pallet_capacity INTEGER NOT NULL DEFAULT 0,
      storage_rate_per_pallet NUMERIC(12,2) NOT NULL DEFAULT 0,
      status listing_status NOT NULL DEFAULT 'Draft',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS service_listings (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      owner_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      city TEXT NOT NULL,
      hourly_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
      status listing_status NOT NULL DEFAULT 'Draft',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      provider_company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      listing_id TEXT NULL REFERENCES warehouse_listings(id) ON DELETE SET NULL,
      service_listing_id TEXT NULL REFERENCES service_listings(id) ON DELETE SET NULL,
      customer_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      status booking_status NOT NULL DEFAULT 'Requested',
      total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'cad',
      scheduled_at TIMESTAMPTZ NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS dock_appointments (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      warehouse_listing_id TEXT NOT NULL REFERENCES warehouse_listings(id) ON DELETE CASCADE,
      booking_id TEXT NULL REFERENCES bookings(id) ON DELETE SET NULL,
      scheduled_start TIMESTAMPTZ NOT NULL,
      scheduled_end TIMESTAMPTZ NOT NULL,
      dock_door TEXT NULL,
      truck_plate TEXT NULL,
      driver_name TEXT NULL,
      appointment_type TEXT NOT NULL,
      pallet_count INTEGER NOT NULL DEFAULT 0,
      status appointment_status NOT NULL DEFAULT 'Requested',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      booking_id TEXT NULL REFERENCES bookings(id) ON DELETE SET NULL,
      gross_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      net_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'cad',
      stripe_payment_intent_id TEXT NULL UNIQUE,
      status payment_status NOT NULL DEFAULT 'Pending',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      paid_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      invoice_number TEXT NOT NULL UNIQUE,
      subtotal_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'cad',
      status invoice_status NOT NULL DEFAULT 'Draft',
      pdf_url TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS message_threads (
      id TEXT PRIMARY KEY,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      booking_id TEXT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      appointment_id TEXT NULL REFERENCES dock_appointments(id) ON DELETE CASCADE,
      dispute_id TEXT NULL,
      scope message_scope NOT NULL,
      subject TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
      read_by JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      channel TEXT NOT NULL,
      read_at TIMESTAMPTZ NULL,
      sent_at TIMESTAMPTZ NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      uploaded_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind file_kind NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes BIGINT NOT NULL,
      storage_provider TEXT NOT NULL,
      public_url TEXT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS expo_push_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expo_push_token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      entity_name TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      previous_value JSONB NULL,
      new_value JSONB NULL,
      request_id TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function createSecondaryTables(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS drivers (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      license_number TEXT NULL,
      phone TEXT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS trucks (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      unit_number TEXT NOT NULL,
      plate_number TEXT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS trailers (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      trailer_number TEXT NOT NULL,
      plate_number TEXT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS containers (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      container_number TEXT NOT NULL,
      container_type TEXT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL,
      comment TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS disputes (
      id TEXT PRIMARY KEY,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      opened_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      booking_id TEXT NULL REFERENCES bookings(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'Open',
      outcome TEXT NULL,
      description TEXT NOT NULL,
      admin_notes TEXT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Pending',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      id TEXT PRIMARY KEY,
      company_id TEXT NULL,
      owner_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS worker_profiles (
      id TEXT PRIMARY KEY,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      owner_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS worker_certifications (
      id TEXT PRIMARY KEY,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      owner_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS shift_posts (
      id TEXT PRIMARY KEY,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      owner_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS shift_applications (
      id TEXT PRIMARY KEY,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      owner_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS shift_assignments (
      id TEXT PRIMARY KEY,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      owner_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id TEXT PRIMARY KEY,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      owner_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS warehouse_capacity (
      id TEXT PRIMARY KEY,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      owner_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS service_jobs (
      id TEXT PRIMARY KEY,
      company_id TEXT NULL REFERENCES companies(id) ON DELETE SET NULL,
      owner_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );
  `);
}

async function createFulfillmentTables(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS inventory_items (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      customer_company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      sku TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 0,
      created_by_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      customer_company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      provider_company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      reference TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      ship_to TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_by_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      picked_at TIMESTAMPTZ NULL,
      packed_at TIMESTAMPTZ NULL,
      shipped_at TIMESTAMPTZ NULL,
      completed_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
      sku TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
      tracking_code TEXT NOT NULL,
      ship_to TEXT NOT NULL DEFAULT '',
      shipped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function createIndexes(): Promise<void> {
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_company_members_user_id ON company_members(user_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_warehouse_listings_company_id ON warehouse_listings(company_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_warehouse_listings_status ON warehouse_listings(status) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_service_listings_company_id ON service_listings(company_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_bookings_company_id ON bookings(company_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_bookings_provider_company_id ON bookings(provider_company_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_dock_appointments_company_id ON dock_appointments(company_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_dock_appointments_listing_start ON dock_appointments(warehouse_listing_id, scheduled_start) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_payments_company_id ON payments(company_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_files_company_id ON files(company_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_audit_logs_company_id ON audit_logs(company_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_name, entity_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_items_booking_id ON inventory_items(booking_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_orders_booking_id ON orders(booking_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_orders_customer_company_id ON orders(customer_company_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_orders_provider_company_id ON orders(provider_company_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
  `);
}

export async function ensureSchema(): Promise<void> {
  if (!globalForDb.__dock2doorSchemaReady) {
    globalForDb.__dock2doorSchemaReady = (async () => {
      console.log('[DB] Ensuring production schema');
      await createEnums();
      await createCoreTables();
      await createSecondaryTables();
      await createFulfillmentTables();
      await createIndexes();
      await createExtendedSchema();
      await createLabourSchema();
      await createWmsSchema();
      await createOpsSchema();
      console.log('[DB] Production schema ready');
      try {
        await seedDemoAccounts();
      } catch (error) {
        console.log('[DB] Demo seed failed during schema bootstrap', error);
      }
    })();
  }

  await globalForDb.__dock2doorSchemaReady;
}

export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function queryRows<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema();
  const result = await db.query<T>(sql, params);
  return result.rows;
}

export async function queryRow<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await queryRows<T>(sql, params);
  return rows[0] ?? null;
}
