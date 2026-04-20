import { Tabs } from 'expo-router';
import { ClipboardCheck, LayoutDashboard } from 'lucide-react-native';
import C from '@/constants/colors';

export default function DriverLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: C.bgSecondary, borderTopColor: C.border, borderTopWidth: 1 },
        tabBarActiveTintColor: C.blue,
        tabBarInactiveTintColor: C.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' as const },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Jobs', tabBarIcon: ({ color }) => <LayoutDashboard size={22} color={color} /> }} />
      <Tabs.Screen name="pod" options={{ title: 'POD', tabBarIcon: ({ color }) => <ClipboardCheck size={22} color={color} /> }} />
    </Tabs>
  );
}
