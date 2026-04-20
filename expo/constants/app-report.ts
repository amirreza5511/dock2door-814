export interface AppReportSection {
  title: string;
  bullets: string[];
}

export const APP_REPORT: AppReportSection[] = [
  {
    title: 'Architecture',
    bullets: [
      'Expo Router frontend with role-based route groups and protected navigation.',
      'Hono + tRPC backend exposed at /api/trpc.',
      'PostgreSQL persistence through pg with schema auto-bootstrap on server start.',
      'JWT access tokens + refresh token rotation for authenticated sessions.',
      'Zustand stores are currently acting as client-side caches over backend data.',
    ],
  },
  {
    title: 'Roles',
    bullets: [
      'Customer, WarehouseProvider, ServiceProvider, Employer, Worker, TruckingCompany, Driver, GateStaff, Admin, SuperAdmin.',
      'Each authenticated role is redirected to its own route prefix after login.',
      'Admin and SuperAdmin have elevated access to global data management screens.',
    ],
  },
  {
    title: 'Primary modules',
    bullets: [
      'Warehouse listings and warehouse booking workflow.',
      'Service provider listings and service job workflow.',
      'Employer shift posts, worker applications, assignments, and time entries.',
      'Payments, invoices, disputes, messages, notifications, and audit logging.',
    ],
  },
];
