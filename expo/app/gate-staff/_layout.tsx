import { Tabs } from 'expo-router';
import { LayoutDashboard, MoveRight } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import C from '@/constants/colors';

export default function GateStaffLayout() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = 64 + Math.max(insets.bottom, 12);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: C.bgSecondary, borderTopColor: C.border, borderTopWidth: 1, height: tabBarHeight, paddingBottom: Math.max(insets.bottom, 12), paddingTop: 8 },
        tabBarActiveTintColor: C.yellow,
        tabBarInactiveTintColor: C.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' as const },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Gate', tabBarIcon: ({ color }) => <LayoutDashboard size={22} color={color} /> }} />
      <Tabs.Screen name="yard" options={{ title: 'Yard', tabBarIcon: ({ color }) => <MoveRight size={22} color={color} /> }} />
    </Tabs>
  );
}
