import { Tabs } from 'expo-router';
import { Database, LayoutDashboard, LineChart, Shield } from 'lucide-react-native';
import C from '@/constants/colors';

export default function SuperAdminLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: C.bgSecondary, borderTopColor: C.border, borderTopWidth: 1 },
        tabBarActiveTintColor: C.red,
        tabBarInactiveTintColor: C.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' as const },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Overview', tabBarIcon: ({ color }) => <LayoutDashboard size={22} color={color} /> }} />
      <Tabs.Screen name="analytics" options={{ title: 'Analytics', tabBarIcon: ({ color }) => <LineChart size={22} color={color} /> }} />
      <Tabs.Screen name="controls" options={{ title: 'Controls', tabBarIcon: ({ color }) => <Shield size={22} color={color} /> }} />
      <Tabs.Screen name="data-manager" options={{ title: 'Data', tabBarIcon: ({ color }) => <Database size={22} color={color} /> }} />
    </Tabs>
  );
}
