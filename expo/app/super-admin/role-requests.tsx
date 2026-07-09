import AdminRoleRequestsScreen from '../admin/role-requests';

/** Super Admin re-uses the same Supabase-direct role-request approval queue as Admin. */
export default function SuperAdminRoleRequests() {
  return <AdminRoleRequestsScreen />;
}
