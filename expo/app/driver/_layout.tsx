import { Tabs } from 'expo-router';
import { ClipboardCheck, LayoutDashboard, ShieldCheck, Warehouse } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import C from '@/constants/colors';

export default function DriverLayout() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = 64 + Math.max(insets.bottom, 12);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: C.bgSecondary, borderTopColor: C.border, borderTopWidth: 1, height: tabBarHeight, paddingBottom: Math.max(insets.bottom, 12), paddingTop: 8 },
        tabBarActiveTintColor: C.blue,
        tabBarInactiveTintColor: C.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' as const },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Jobs', tabBarIcon: ({ color }) => <LayoutDashboard size={22} color={color} /> }} />
      <Tabs.Screen name="dropoff" options={{ title: 'Drop-off', tabBarIcon: ({ color }) => <Warehouse size={22} color={color} /> }} />
      <Tabs.Screen name="documents" options={{ title: 'Compliance', tabBarIcon: ({ color }) => <ShieldCheck size={22} color={color} /> }} />
      <Tabs.Screen name="pod" options={{ title: 'POD', tabBarIcon: ({ color }) => <ClipboardCheck size={22} color={color} /> }} />
    </Tabs>
  );
}
