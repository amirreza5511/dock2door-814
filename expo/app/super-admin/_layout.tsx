import { Tabs } from 'expo-router';
import { Award, Building2, ClipboardCheck, Database, LayoutDashboard, LineChart, Shield, Users } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import C from '@/constants/colors';

export default function SuperAdminLayout() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = 64 + Math.max(insets.bottom, 12);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: C.bgSecondary, borderTopColor: C.border, borderTopWidth: 1, height: tabBarHeight, paddingBottom: Math.max(insets.bottom, 12), paddingTop: 8 },
        tabBarActiveTintColor: C.red,
        tabBarInactiveTintColor: C.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' as const },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Overview', tabBarIcon: ({ color }) => <LayoutDashboard size={22} color={color} /> }} />
      <Tabs.Screen name="analytics" options={{ title: 'Analytics', tabBarIcon: ({ color }) => <LineChart size={22} color={color} /> }} />
      {/* These tabs navigate to the shared admin screens — SuperAdmin has full access to the /admin segment */}
      <Tabs.Screen
        name="certifications-redirect"
        options={{
          title: 'Certs',
          tabBarIcon: ({ color }) => <Award size={22} color={color} />,
          href: '/admin/certifications',
        }}
      />
      <Tabs.Screen
        name="compliance-redirect"
        options={{
          title: 'Compliance',
          tabBarIcon: ({ color }) => <ClipboardCheck size={22} color={color} />,
          href: '/admin/compliance',
        }}
      />
      <Tabs.Screen
        name="users-redirect"
        options={{
          title: 'Users',
          tabBarIcon: ({ color }) => <Users size={22} color={color} />,
          href: '/admin/users',
        }}
      />
      <Tabs.Screen
        name="companies-redirect"
        options={{
          title: 'Companies',
          tabBarIcon: ({ color }) => <Building2 size={22} color={color} />,
          href: '/admin/companies',
        }}
      />
      <Tabs.Screen name="controls" options={{ title: 'Controls', tabBarIcon: ({ color }) => <Shield size={22} color={color} /> }} />
      <Tabs.Screen name="data-manager" options={{ title: 'Data', tabBarIcon: ({ color }) => <Database size={22} color={color} /> }} />
    </Tabs>
  );
}
