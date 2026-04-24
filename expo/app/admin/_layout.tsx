import { Tabs } from 'expo-router';
import { LayoutDashboard, Building2, Users, Settings, AlertTriangle, ScrollText, Database, Receipt, Award, BellRing, Route } from 'lucide-react-native';
import C from '@/constants/colors';

export default function AdminLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: C.bgSecondary, borderTopColor: C.border, borderTopWidth: 1, height: 60, paddingBottom: 8 },
        tabBarActiveTintColor: C.red,
        tabBarInactiveTintColor: C.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' as const },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: ({ color }) => <LayoutDashboard size={22} color={color} /> }} />
      <Tabs.Screen name="companies" options={{ title: 'Companies', tabBarIcon: ({ color }) => <Building2 size={22} color={color} /> }} />
      <Tabs.Screen name="users" options={{ title: 'Users', tabBarIcon: ({ color }) => <Users size={22} color={color} /> }} />
      <Tabs.Screen name="certifications" options={{ title: 'Certs', tabBarIcon: ({ color }) => <Award size={22} color={color} /> }} />
      <Tabs.Screen name="bookings" options={{ title: 'Routing', tabBarIcon: ({ color }) => <Route size={22} color={color} /> }} />
      <Tabs.Screen name="disputes" options={{ title: 'Disputes', tabBarIcon: ({ color }) => <AlertTriangle size={22} color={color} /> }} />
      <Tabs.Screen name="billing" options={{ title: 'Billing', tabBarIcon: ({ color }) => <Receipt size={22} color={color} /> }} />
      <Tabs.Screen name="entities" options={{ title: 'Entities', tabBarIcon: ({ color }) => <Database size={22} color={color} /> }} />
      <Tabs.Screen name="audit-logs" options={{ title: 'Audit', tabBarIcon: ({ color }) => <ScrollText size={22} color={color} /> }} />
      <Tabs.Screen name="notifications-health" options={{ title: 'Notify', tabBarIcon: ({ color }) => <BellRing size={22} color={color} /> }} />
      <Tabs.Screen name="platform-settings" options={{ title: 'Settings', tabBarIcon: ({ color }) => <Settings size={22} color={color} /> }} />
    </Tabs>
  );
}
