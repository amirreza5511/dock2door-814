import type { CompanyType, UserRole } from '@/constants/types';

export interface DemoAccount {
  label: string;
  role: UserRole;
  email: string;
  password: string;
  displayName: string;
  companyType?: CompanyType;
}

export const DEMO_AUTH_EMAIL = 'admin@dock2door.ca';
export const DEMO_AUTH_PASSWORD = 'admin123';

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    label: 'Admin',
    role: 'Admin',
    email: 'admin@dock2door.ca',
    password: 'admin123',
    displayName: 'Platform Admin Demo',
  },
  {
    label: 'Customer',
    role: 'Customer',
    email: 'customer@freshmart.ca',
    password: 'password',
    displayName: 'FreshMart Demo',
    companyType: 'Customer',
  },
  {
    label: 'Warehouse',
    role: 'WarehouseProvider',
    email: 'provider@vandc.ca',
    password: 'password',
    displayName: 'Warehouse Provider Demo',
    companyType: 'WarehouseProvider',
  },
  {
    label: 'Service',
    role: 'ServiceProvider',
    email: 'service@deltadev.ca',
    password: 'password',
    displayName: 'Service Provider Demo',
    companyType: 'ServiceProvider',
  },
  {
    label: 'Employer',
    role: 'Employer',
    email: 'employer@deltalog.ca',
    password: 'password',
    displayName: 'Employer Demo',
    companyType: 'Employer',
  },
  {
    label: 'Worker',
    role: 'Worker',
    email: 'worker.marcus@gmail.com',
    password: 'password',
    displayName: 'Worker Demo',
  },
  {
    label: 'Super Admin',
    role: 'SuperAdmin',
    email: 'superadmin@dock2door.ca',
    password: 'admin123',
    displayName: 'Super Admin Demo',
  },
];

export function findDemoAccount(email: string): DemoAccount | undefined {
  const normalized = email.trim().toLowerCase();
  return DEMO_ACCOUNTS.find((account) => account.email.toLowerCase() === normalized);
}
