import { Tabs } from 'expo-router';
import { LayoutDashboard, Wrench, ClipboardList, PlusCircle, Receipt } from 'lucide-react-native';
import C from '@/constants/colors';

export default function ServiceProviderLayout() {
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
      <Tabs.Screen name="listings" options={{ title: 'Services', tabBarIcon: ({ color }) => <Wrench size={22} color={color} /> }} />
      <Tabs.Screen name="jobs" options={{ title: 'Jobs', tabBarIcon: ({ color }) => <ClipboardList size={22} color={color} /> }} />
      <Tabs.Screen name="create-listing" options={{ title: 'New Service', tabBarIcon: ({ color }) => <PlusCircle size={22} color={color} /> }} />
      <Tabs.Screen name="billing" options={{ title: 'Billing', tabBarIcon: ({ color }) => <Receipt size={22} color={color} /> }} />
    </Tabs>
  );
}
