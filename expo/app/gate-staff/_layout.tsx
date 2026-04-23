import { Tabs } from 'expo-router';
import { LayoutDashboard, MoveRight } from 'lucide-react-native';
import C from '@/constants/colors';

export default function GateStaffLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: C.bgSecondary, borderTopColor: C.border, borderTopWidth: 1 },
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
