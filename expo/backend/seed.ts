import { db } from '@/backend/db';
import { hashPassword, verifyPassword } from '@/backend/auth';

interface SeedCompany {
  id: string;
  name: string;
  type: 'Customer' | 'WarehouseProvider' | 'ServiceProvider' | 'Employer' | 'TruckingCompany';
  address: string;
  city: string;
}

interface SeedUser {
  id: string;
  email: string;
  password: string;
  name: string;
  role: 'Customer' | 'WarehouseProvider' | 'ServiceProvider' | 'Employer' | 'Worker' | 'Admin' | 'SuperAdmin';
  companyId: string | null;
}

const SEED_COMPANIES: SeedCompany[] = [
  { id: 'seed-c1', name: 'FreshMart Groceries', type: 'Customer', address: '1200 Seymour St', city: 'Vancouver' },
  { id: 'seed-c2', name: 'Vancouver Distribution Center', type: 'WarehouseProvider', address: '8800 Bridgeport Rd', city: 'Vancouver' },
  { id: 'seed-c3', name: 'Richmond Cold Storage', type: 'WarehouseProvider', address: '12500 Vulcan Way', city: 'Richmond' },
  { id: 'seed-c5', name: 'Delta Devanning Crew', type: 'ServiceProvider', address: '5600 Ladner Trunk Rd', city: 'Delta' },
  { id: 'seed-c9', name: 'Delta Logistics Co', type: 'Employer', address: '6200 Tilbury Ave', city: 'Delta' },
];

const SEED_USERS: SeedUser[] = [
  { id: 'seed-u1', email: 'admin@dock2door.ca', password: 'admin123', name: 'Admin User', role: 'Admin', companyId: null },
  { id: 'seed-u2', email: 'customer@freshmart.ca', password: 'password', name: 'James Chen', role: 'Customer', companyId: 'seed-c1' },
  { id: 'seed-u3', email: 'provider@vandc.ca', password: 'password', name: 'Sarah Kim', role: 'WarehouseProvider', companyId: 'seed-c2' },
  { id: 'seed-u4', email: 'provider@richmond.ca', password: 'password', name: 'David Park', role: 'WarehouseProvider', companyId: 'seed-c3' },
  { id: 'seed-u5', email: 'service@deltadev.ca', password: 'password', name: 'Mike Torres', role: 'ServiceProvider', companyId: 'seed-c5' },
  { id: 'seed-u6', email: 'employer@deltalog.ca', password: 'password', name: 'Tom Wilson', role: 'Employer', companyId: 'seed-c9' },
  { id: 'seed-u7', email: 'worker.marcus@gmail.com', password: 'password', name: 'Marcus Chen', role: 'Worker', companyId: null },
  { id: 'seed-u8', email: 'worker.ana@gmail.com', password: 'password', name: 'Ana Rodriguez', role: 'Worker', companyId: null },
];

interface UserHashRow {
  id: string;
  email: string;
  password_hash: string;
  status: string;
}

export async function seedDemoAccounts(): Promise<void> {
  console.log('[Seed] Seeding demo accounts…');

  let companyCount = 0;
  for (const company of SEED_COMPANIES) {
    await db.query(
      `INSERT INTO companies (id, name, type, address, city, status)
       VALUES ($1, $2, $3, $4, $5, 'Approved')
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         type = EXCLUDED.type,
         address = EXCLUDED.address,
         city = EXCLUDED.city,
         status = 'Approved'`,
      [company.id, company.name, company.type, company.address, company.city],
    );
    companyCount += 1;
  }

  let userCount = 0;
  for (const user of SEED_USERS) {
    const passwordHash = hashPassword(user.password);
    await db.query(
      `INSERT INTO users (id, email, password_hash, name, role, company_id, status, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6, 'Active', true)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         status = 'Active',
         email_verified = true,
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         company_id = EXCLUDED.company_id`,
      [user.id, user.email.toLowerCase(), passwordHash, user.name, user.role, user.companyId],
    );

    if (user.companyId) {
      await db.query(
        `INSERT INTO company_members (id, company_id, user_id, company_role, status)
         VALUES ($1, $2, $3, 'Owner', 'Active')
         ON CONFLICT (company_id, user_id) DO NOTHING`,
        [`seed-cm-${user.id}`, user.companyId, user.id],
      );
    }
    userCount += 1;
  }

  console.log(`[Seed] Upserted ${companyCount} companies, ${userCount} users`);

  let verifiedCount = 0;
  const failures: string[] = [];
  for (const user of SEED_USERS) {
    const result = await db.query<UserHashRow>(
      'SELECT id, email, password_hash, status FROM users WHERE email = $1 AND deleted_at IS NULL',
      [user.email.toLowerCase()],
    );
    const row = result.rows[0];
    if (!row) {
      console.log(`[Seed] ❌ Missing user row for ${user.email}`);
      failures.push(user.email);
      continue;
    }
    if (row.status !== 'Active') {
      console.log(`[Seed] ❌ User ${user.email} has status ${row.status}`);
      failures.push(user.email);
      continue;
    }
    const matches = verifyPassword(user.password, row.password_hash);
    if (!matches) {
      console.log(`[Seed] ❌ Password hash mismatch for ${user.email}`);
      failures.push(user.email);
      continue;
    }
    console.log(`[Seed] ✓ Verified login for ${user.email}`);
    verifiedCount += 1;
  }

  if (failures.length > 0) {
    console.log(`[Seed] Demo seed complete with ${failures.length} failures: ${failures.join(', ')}`);
  } else {
    console.log(`[Seed] Demo seed complete — ${verifiedCount}/${SEED_USERS.length} accounts verified`);
  }
}
