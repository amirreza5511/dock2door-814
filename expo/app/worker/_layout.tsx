import { Tabs } from 'expo-router';
import { LayoutDashboard, Search, CalendarCheck, UserCircle, CalendarDays } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import C from '@/constants/colors';

export default function WorkerLayout() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = 64 + Math.max(insets.bottom, 12);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: C.bgSecondary, borderTopColor: C.border, borderTopWidth: 1, height: tabBarHeight, paddingBottom: Math.max(insets.bottom, 12), paddingTop: 8 },
        tabBarActiveTintColor: C.accent,
        tabBarInactiveTintColor: C.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' as const },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: ({ color }) => <LayoutDashboard size={22} color={color} /> }} />
      <Tabs.Screen name="browse" options={{ title: 'Find Shifts', tabBarIcon: ({ color }) => <Search size={22} color={color} /> }} />
      <Tabs.Screen name="my-shifts" options={{ title: 'My Shifts', tabBarIcon: ({ color }) => <CalendarCheck size={22} color={color} /> }} />
      <Tabs.Screen name="availability" options={{ title: 'Availability', tabBarIcon: ({ color }) => <CalendarDays size={22} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <UserCircle size={22} color={color} /> }} />
      <Tabs.Screen name="[id]" options={{ href: null }} />
      <Tabs.Screen name="shift-confirm" options={{ href: null }} />
      <Tabs.Screen name="earnings" options={{ href: null }} />
    </Tabs>
  );
}
