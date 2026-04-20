import { db } from '@/backend/db';

export async function createOpsSchema(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS yard_locations (
      id TEXT PRIMARY KEY,
      warehouse_listing_id TEXT NOT NULL REFERENCES warehouse_listings(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'Parking',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(warehouse_listing_id, code)
    );

    CREATE TABLE IF NOT EXISTS yard_moves (
      id TEXT PRIMARY KEY,
      warehouse_listing_id TEXT NOT NULL REFERENCES warehouse_listings(id) ON DELETE CASCADE,
      appointment_id TEXT NULL REFERENCES dock_appointments(id) ON DELETE SET NULL,
      trailer_number TEXT NULL,
      truck_plate TEXT NULL,
      from_location_id TEXT NULL REFERENCES yard_locations(id) ON DELETE SET NULL,
      to_location_id TEXT NULL REFERENCES yard_locations(id) ON DELETE SET NULL,
      actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      notes TEXT NULL,
      moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_yard_moves_listing ON yard_moves(warehouse_listing_id);
    CREATE INDEX IF NOT EXISTS idx_yard_moves_appointment ON yard_moves(appointment_id);

    CREATE TABLE IF NOT EXISTS appointment_delays (
      id TEXT PRIMARY KEY,
      appointment_id TEXT NOT NULL REFERENCES dock_appointments(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      delay_minutes INTEGER NOT NULL DEFAULT 0,
      actor_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_appointment_delays_appt ON appointment_delays(appointment_id);

    CREATE TABLE IF NOT EXISTS packing_slip_items (
      id TEXT PRIMARY KEY,
      packing_slip_id TEXT NOT NULL REFERENCES packing_slips(id) ON DELETE CASCADE,
      order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL
    );
  `);

  console.log('[DB] Ops schema ready');
}
