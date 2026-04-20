import { db } from '@/backend/db';

export async function createExtendedSchema(): Promise<void> {
  await db.query(`
    DO $$ BEGIN
      CREATE TYPE quote_status AS ENUM ('Draft', 'Sent', 'Accepted', 'Rejected', 'Expired', 'Superseded');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE stock_movement_kind AS ENUM ('Receipt', 'Adjustment', 'Pick', 'Pack', 'Ship', 'Return', 'Transfer', 'Hold', 'Release', 'CycleCount');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE fulfillment_task_status AS ENUM ('Pending', 'InProgress', 'Completed', 'Cancelled', 'Exception');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE carrier_code AS ENUM ('CanadaPost', 'Purolator', 'FedEx', 'UPS', 'Internal');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE channel_kind AS ENUM ('Shopify', 'WooCommerce', 'AmazonSPAPI', 'Manual');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS booking_status_history (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      actor_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      previous_status booking_status NULL,
      new_status booking_status NOT NULL,
      note TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_booking_status_history_booking ON booking_status_history(booking_id);

    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      provider_company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      customer_company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      status quote_status NOT NULL DEFAULT 'Draft',
      current_version INTEGER NOT NULL DEFAULT 1,
      expires_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );
    CREATE INDEX IF NOT EXISTS idx_quotes_booking ON quotes(booking_id);

    CREATE TABLE IF NOT EXISTS quote_versions (
      id TEXT PRIMARY KEY,
      quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      proposed_by_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'cad',
      terms JSONB NOT NULL DEFAULT '{}'::jsonb,
      message TEXT NULL,
      expires_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(quote_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_quote_versions_quote ON quote_versions(quote_id);

    CREATE TABLE IF NOT EXISTS counter_offers (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      quote_version_id TEXT NULL REFERENCES quote_versions(id) ON DELETE SET NULL,
      proposed_by_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      proposed_by_role TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'cad',
      message TEXT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ NULL
    );
    CREATE INDEX IF NOT EXISTS idx_counter_offers_booking ON counter_offers(booking_id);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS warehouse_media (
      id TEXT PRIMARY KEY,
      warehouse_listing_id TEXT NOT NULL REFERENCES warehouse_listings(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'image',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );
    CREATE INDEX IF NOT EXISTS idx_warehouse_media_listing ON warehouse_media(warehouse_listing_id);

    CREATE TABLE IF NOT EXISTS warehouse_pricing (
      id TEXT PRIMARY KEY,
      warehouse_listing_id TEXT NOT NULL REFERENCES warehouse_listings(id) ON DELETE CASCADE,
      unit TEXT NOT NULL,
      period TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'cad',
      min_units INTEGER NOT NULL DEFAULT 0,
      max_units INTEGER NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );
    CREATE INDEX IF NOT EXISTS idx_warehouse_pricing_listing ON warehouse_pricing(warehouse_listing_id);

    CREATE TABLE IF NOT EXISTS warehouse_operating_hours (
      id TEXT PRIMARY KEY,
      warehouse_listing_id TEXT NOT NULL REFERENCES warehouse_listings(id) ON DELETE CASCADE,
      day_of_week SMALLINT NOT NULL,
      open_time TIME NOT NULL,
      close_time TIME NOT NULL,
      is_closed BOOLEAN NOT NULL DEFAULT FALSE,
      UNIQUE(warehouse_listing_id, day_of_week)
    );

    CREATE TABLE IF NOT EXISTS warehouse_capacity_segments (
      id TEXT PRIMARY KEY,
      warehouse_listing_id TEXT NOT NULL REFERENCES warehouse_listings(id) ON DELETE CASCADE,
      segment_type TEXT NOT NULL,
      total_capacity INTEGER NOT NULL DEFAULT 0,
      used_capacity INTEGER NOT NULL DEFAULT 0,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_warehouse_capacity_segments_listing ON warehouse_capacity_segments(warehouse_listing_id);

    CREATE TABLE IF NOT EXISTS warehouse_availability (
      id TEXT PRIMARY KEY,
      warehouse_listing_id TEXT NOT NULL REFERENCES warehouse_listings(id) ON DELETE CASCADE,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      available_units INTEGER NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'pallet',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_warehouse_availability_listing ON warehouse_availability(warehouse_listing_id, start_date, end_date);

    CREATE TABLE IF NOT EXISTS warehouse_features (
      id TEXT PRIMARY KEY,
      warehouse_listing_id TEXT NOT NULL REFERENCES warehouse_listings(id) ON DELETE CASCADE,
      feature_key TEXT NOT NULL,
      value TEXT NULL,
      UNIQUE(warehouse_listing_id, feature_key)
    );

    CREATE TABLE IF NOT EXISTS service_areas (
      id TEXT PRIMARY KEY,
      service_listing_id TEXT NOT NULL REFERENCES service_listings(id) ON DELETE CASCADE,
      city TEXT NOT NULL,
      province TEXT NULL,
      radius_km INTEGER NULL
    );
    CREATE INDEX IF NOT EXISTS idx_service_areas_listing ON service_areas(service_listing_id);

    CREATE TABLE IF NOT EXISTS service_pricing (
      id TEXT PRIMARY KEY,
      service_listing_id TEXT NOT NULL REFERENCES service_listings(id) ON DELETE CASCADE,
      unit TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'cad',
      minimum_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL
    );
    CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id) WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      sku TEXT NOT NULL,
      barcode TEXT NULL,
      name TEXT NOT NULL DEFAULT '',
      weight_grams INTEGER NULL,
      length_cm NUMERIC(8,2) NULL,
      width_cm NUMERIC(8,2) NULL,
      height_cm NUMERIC(8,2) NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL,
      UNIQUE(product_id, sku)
    );
    CREATE INDEX IF NOT EXISTS idx_product_variants_sku ON product_variants(sku);

    CREATE TABLE IF NOT EXISTS bin_locations (
      id TEXT PRIMARY KEY,
      warehouse_listing_id TEXT NOT NULL REFERENCES warehouse_listings(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      zone TEXT NULL,
      aisle TEXT NULL,
      rack TEXT NULL,
      shelf TEXT NULL,
      bin TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL,
      UNIQUE(warehouse_listing_id, code)
    );

    CREATE TABLE IF NOT EXISTS stock_levels (
      id TEXT PRIMARY KEY,
      inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      bin_location_id TEXT NULL REFERENCES bin_locations(id) ON DELETE SET NULL,
      on_hand INTEGER NOT NULL DEFAULT 0,
      allocated INTEGER NOT NULL DEFAULT 0,
      damaged INTEGER NOT NULL DEFAULT 0,
      quarantined INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_stock_levels_inventory ON stock_levels(inventory_item_id);

    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      kind stock_movement_kind NOT NULL,
      quantity INTEGER NOT NULL,
      reference_type TEXT NULL,
      reference_id TEXT NULL,
      actor_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      note TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_stock_movements_inventory ON stock_movements(inventory_item_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_reference ON stock_movements(reference_type, reference_id);

    CREATE TABLE IF NOT EXISTS inventory_adjustments (
      id TEXT PRIMARY KEY,
      inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delta_quantity INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS order_status_history (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      actor_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      previous_status TEXT NULL,
      new_status TEXT NOT NULL,
      note TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id);

    CREATE TABLE IF NOT EXISTS fulfillments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status fulfillment_task_status NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS fulfillment_items (
      id TEXT PRIMARY KEY,
      fulfillment_id TEXT NOT NULL REFERENCES fulfillments(id) ON DELETE CASCADE,
      order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pick_tasks (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      assigned_to_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      status fulfillment_task_status NOT NULL DEFAULT 'Pending',
      started_at TIMESTAMPTZ NULL,
      completed_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS pack_tasks (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      assigned_to_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      status fulfillment_task_status NOT NULL DEFAULT 'Pending',
      started_at TIMESTAMPTZ NULL,
      completed_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS packing_slips (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      file_id TEXT NULL REFERENCES files(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS shipping_labels (
      id TEXT PRIMARY KEY,
      shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
      carrier carrier_code NOT NULL,
      tracking_number TEXT NULL,
      label_url TEXT NULL,
      rate_amount NUMERIC(12,2) NULL,
      currency TEXT NOT NULL DEFAULT 'cad',
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tracking_events (
      id TEXT PRIMARY KEY,
      shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
      carrier carrier_code NOT NULL,
      status TEXT NOT NULL,
      description TEXT NULL,
      location TEXT NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_tracking_events_shipment ON tracking_events(shipment_id);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS dock_doors (
      id TEXT PRIMARY KEY,
      warehouse_listing_id TEXT NOT NULL REFERENCES warehouse_listings(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(warehouse_listing_id, code)
    );

    CREATE TABLE IF NOT EXISTS dock_blocked_windows (
      id TEXT PRIMARY KEY,
      warehouse_listing_id TEXT NOT NULL REFERENCES warehouse_listings(id) ON DELETE CASCADE,
      dock_door_id TEXT NULL REFERENCES dock_doors(id) ON DELETE CASCADE,
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ NOT NULL,
      reason TEXT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dock_blocked_windows_listing ON dock_blocked_windows(warehouse_listing_id, start_time, end_time);

    CREATE TABLE IF NOT EXISTS gate_check_ins (
      id TEXT PRIMARY KEY,
      appointment_id TEXT NOT NULL REFERENCES dock_appointments(id) ON DELETE CASCADE,
      actor_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      driver_name TEXT NULL,
      truck_plate TEXT NULL,
      trailer_number TEXT NULL,
      reference_number TEXT NULL,
      notes TEXT NULL,
      checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS gate_check_outs (
      id TEXT PRIMARY KEY,
      appointment_id TEXT NOT NULL REFERENCES dock_appointments(id) ON DELETE CASCADE,
      actor_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      notes TEXT NULL,
      checked_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS payout_accounts (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'stripe',
      external_account_id TEXT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payout_batches (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'cad',
      status TEXT NOT NULL DEFAULT 'Pending',
      approved_by_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      processed_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS provider_earnings (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      payment_id TEXT NULL REFERENCES payments(id) ON DELETE SET NULL,
      payout_batch_id TEXT NULL REFERENCES payout_batches(id) ON DELETE SET NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'cad',
      status TEXT NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_provider_earnings_company ON provider_earnings(company_id);

    CREATE TABLE IF NOT EXISTS commission_rules (
      id TEXT PRIMARY KEY,
      module TEXT NOT NULL,
      percentage NUMERIC(6,3) NOT NULL DEFAULT 8.0,
      minimum_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'cad',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tax_rules (
      id TEXT PRIMARY KEY,
      jurisdiction TEXT NOT NULL,
      rate NUMERIC(6,3) NOT NULL,
      applies_to TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS refunds (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'cad',
      reason TEXT NULL,
      stripe_refund_id TEXT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS credit_notes (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'cad',
      reason TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS feature_flags (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      description TEXT NULL,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      rollout JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notification_preferences (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      muted_events JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      kind channel_kind NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS channel_connections (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'Active',
      last_sync_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(company_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS customer_stores (
      id TEXT PRIMARY KEY,
      channel_connection_id TEXT NOT NULL REFERENCES channel_connections(id) ON DELETE CASCADE,
      external_store_id TEXT NOT NULL,
      domain TEXT NULL,
      name TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(channel_connection_id, external_store_id)
    );

    CREATE TABLE IF NOT EXISTS external_orders (
      id TEXT PRIMARY KEY,
      channel_connection_id TEXT NOT NULL REFERENCES channel_connections(id) ON DELETE CASCADE,
      external_order_id TEXT NOT NULL,
      order_id TEXT NULL REFERENCES orders(id) ON DELETE SET NULL,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(channel_connection_id, external_order_id)
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'Received',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      scope TEXT NOT NULL,
      response JSONB NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log('[DB] Extended production schema ready');
}
