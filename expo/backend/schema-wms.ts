import { db } from '@/backend/db';

export async function createWmsSchema(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS lots (
      id TEXT PRIMARY KEY,
      inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      lot_number TEXT NOT NULL,
      expires_at DATE NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      quantity INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(inventory_item_id, lot_number)
    );
    CREATE INDEX IF NOT EXISTS idx_lots_inventory ON lots(inventory_item_id);

    CREATE TABLE IF NOT EXISTS serials (
      id TEXT PRIMARY KEY,
      inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      serial_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'InStock',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(inventory_item_id, serial_number)
    );
    CREATE INDEX IF NOT EXISTS idx_serials_inventory ON serials(inventory_item_id);

    CREATE TABLE IF NOT EXISTS holds (
      id TEXT PRIMARY KEY,
      inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      actor_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      released_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_holds_inventory ON holds(inventory_item_id) WHERE status = 'Active';

    CREATE TABLE IF NOT EXISTS asns (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      customer_company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      provider_company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      reference TEXT NOT NULL,
      expected_at TIMESTAMPTZ NULL,
      status TEXT NOT NULL DEFAULT 'Expected',
      notes TEXT NULL,
      created_by_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_asns_booking ON asns(booking_id);

    CREATE TABLE IF NOT EXISTS asn_items (
      id TEXT PRIMARY KEY,
      asn_id TEXT NOT NULL REFERENCES asns(id) ON DELETE CASCADE,
      sku TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      expected_quantity INTEGER NOT NULL,
      received_quantity INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      asn_id TEXT NULL REFERENCES asns(id) ON DELETE SET NULL,
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notes TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS receipt_items (
      id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
      inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL,
      bin_location_id TEXT NULL REFERENCES bin_locations(id) ON DELETE SET NULL,
      lot_id TEXT NULL REFERENCES lots(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS cycle_counts (
      id TEXT PRIMARY KEY,
      warehouse_listing_id TEXT NOT NULL REFERENCES warehouse_listings(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'Draft',
      notes TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS cycle_count_lines (
      id TEXT PRIMARY KEY,
      cycle_count_id TEXT NOT NULL REFERENCES cycle_counts(id) ON DELETE CASCADE,
      inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      expected_quantity INTEGER NOT NULL,
      counted_quantity INTEGER NOT NULL,
      variance INTEGER GENERATED ALWAYS AS (counted_quantity - expected_quantity) STORED
    );

    CREATE TABLE IF NOT EXISTS kits (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(company_id, sku)
    );

    CREATE TABLE IF NOT EXISTS kit_components (
      id TEXT PRIMARY KEY,
      kit_id TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      component_sku TEXT NOT NULL,
      quantity INTEGER NOT NULL
    );
  `);

  console.log('[DB] WMS schema ready');
}
