import { db } from '@/backend/db';

export async function createLabourSchema(): Promise<void> {
  await db.query(`
    ALTER TABLE worker_profiles
      ADD COLUMN IF NOT EXISTS full_name TEXT,
      ADD COLUMN IF NOT EXISTS phone TEXT,
      ADD COLUMN IF NOT EXISTS city TEXT,
      ADD COLUMN IF NOT EXISTS hourly_rate_min NUMERIC(10,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS bio TEXT,
      ADD COLUMN IF NOT EXISTS rating_average NUMERIC(4,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE worker_certifications
      ADD COLUMN IF NOT EXISTS name TEXT,
      ADD COLUMN IF NOT EXISTS issuing_body TEXT,
      ADD COLUMN IF NOT EXISTS issued_at DATE,
      ADD COLUMN IF NOT EXISTS expires_at DATE,
      ADD COLUMN IF NOT EXISTS file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

    ALTER TABLE shift_posts
      ADD COLUMN IF NOT EXISTS warehouse_listing_id TEXT REFERENCES warehouse_listings(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS title TEXT,
      ADD COLUMN IF NOT EXISTS role TEXT,
      ADD COLUMN IF NOT EXISTS required_skill TEXT,
      ADD COLUMN IF NOT EXISTS required_certifications JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS headcount INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS description TEXT;

    ALTER TABLE shift_applications
      ADD COLUMN IF NOT EXISTS shift_post_id TEXT REFERENCES shift_posts(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS worker_profile_id TEXT REFERENCES worker_profiles(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS message TEXT;

    ALTER TABLE shift_assignments
      ADD COLUMN IF NOT EXISTS shift_post_id TEXT REFERENCES shift_posts(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS worker_profile_id TEXT REFERENCES worker_profiles(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS application_id TEXT REFERENCES shift_applications(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMPTZ;

    ALTER TABLE time_entries
      ADD COLUMN IF NOT EXISTS assignment_id TEXT REFERENCES shift_assignments(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS clock_in_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS clock_out_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS total_minutes INTEGER,
      ADD COLUMN IF NOT EXISTS confirmed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS idx_shift_posts_company_start ON shift_posts(company_id, start_at);
    CREATE INDEX IF NOT EXISTS idx_shift_applications_shift ON shift_applications(shift_post_id);
    CREATE INDEX IF NOT EXISTS idx_shift_assignments_shift ON shift_assignments(shift_post_id);
    CREATE INDEX IF NOT EXISTS idx_shift_assignments_worker ON shift_assignments(worker_profile_id);
    CREATE INDEX IF NOT EXISTS idx_time_entries_assignment ON time_entries(assignment_id);

    CREATE TABLE IF NOT EXISTS worker_ratings (
      id TEXT PRIMARY KEY,
      worker_profile_id TEXT NOT NULL REFERENCES worker_profiles(id) ON DELETE CASCADE,
      assignment_id TEXT NULL REFERENCES shift_assignments(id) ON DELETE SET NULL,
      rater_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_worker_ratings_worker ON worker_ratings(worker_profile_id);
  `);

  console.log('[DB] Labour schema ready');
}
