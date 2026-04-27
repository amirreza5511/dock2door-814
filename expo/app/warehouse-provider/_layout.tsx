import { Tabs } from 'expo-router';
import { LayoutDashboard, Warehouse, BookOpen, PlusCircle, Users, Archive, Wallet } from 'lucide-react-native';
import C from '@/constants/colors';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import { can } from '@/lib/permissions';

export default function WarehouseProviderLayout() {
  const { activeCompany } = useActiveCompany();
  const role = activeCompany?.role ?? null;
  const canListings = can(role, 'listings.manage');
  const canBookings = can(role, 'bookings.view');
  const canStaff = can(role, 'staff.manage');
  const canWms = can(role, 'wms.view');
  const canPayouts = can(role, 'payouts.manage');

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: C.bgSecondary, borderTopColor: C.border, borderTopWidth: 1, height: 60, paddingBottom: 8 },
        tabBarActiveTintColor: C.accent,
        tabBarInactiveTintColor: C.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' as const },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: ({ color }) => <LayoutDashboard size={22} color={color} /> }} />
      <Tabs.Screen name="listings" options={{ title: 'Listings', tabBarIcon: ({ color }) => <Warehouse size={22} color={color} />, href: canListings ? undefined : null }} />
      <Tabs.Screen name="bookings" options={{ title: 'Bookings', tabBarIcon: ({ color }) => <BookOpen size={22} color={color} />, href: canBookings ? undefined : null }} />
      <Tabs.Screen name="create-listing" options={{ title: 'New', tabBarIcon: ({ color }) => <PlusCircle size={22} color={color} />, href: canListings ? undefined : null }} />
      <Tabs.Screen name="staff" options={{ title: 'Staff', tabBarIcon: ({ color }) => <Users size={22} color={color} />, href: canStaff ? undefined : null }} />
      <Tabs.Screen name="wms" options={{ title: 'WMS', tabBarIcon: ({ color }) => <Archive size={22} color={color} />, href: canWms ? undefined : null }} />
      <Tabs.Screen name="stripe-connect" options={{ title: 'Payouts', tabBarIcon: ({ color }) => <Wallet size={22} color={color} />, href: canPayouts ? undefined : null }} />
      <Tabs.Screen name="billing" options={{ href: null }} />
    </Tabs>
  );
}
