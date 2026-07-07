import { Tabs } from 'expo-router';
import { LayoutDashboard, CalendarDays, PlusCircle, Users, UsersRound } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import C from '@/constants/colors';

export default function EmployerLayout() {
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
      <Tabs.Screen name="shifts" options={{ title: 'Shifts', tabBarIcon: ({ color }) => <CalendarDays size={22} color={color} /> }} />
      <Tabs.Screen name="create-shift" options={{ title: 'Post Shift', tabBarIcon: ({ color }) => <PlusCircle size={22} color={color} /> }} />
      <Tabs.Screen name="browse-workers" options={{ title: 'Find Workers', tabBarIcon: ({ color }) => <Users size={22} color={color} /> }} />
      <Tabs.Screen name="team" options={{ title: 'Team', tabBarIcon: ({ color }) => <UsersRound size={22} color={color} /> }} />
      <Tabs.Screen name="rates" options={{ href: null }} />
      <Tabs.Screen name="invoicing" options={{ href: null }} />
      <Tabs.Screen name="company-profile" options={{ href: null }} />
      <Tabs.Screen name="account" options={{ href: null }} />
      <Tabs.Screen name="billing" options={{ href: null }} />
    </Tabs>
  );
}
