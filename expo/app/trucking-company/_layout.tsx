import { Tabs } from 'expo-router';
import { CalendarDays, CreditCard, LayoutDashboard, MessagesSquare, Truck } from 'lucide-react-native';
import C from '@/constants/colors';

export default function TruckingCompanyLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: C.bgSecondary, borderTopColor: C.border, borderTopWidth: 1 },
        tabBarActiveTintColor: C.accent,
        tabBarInactiveTintColor: C.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' as const },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: ({ color }) => <LayoutDashboard size={22} color={color} /> }} />
      <Tabs.Screen name="appointments" options={{ title: 'Appointments', tabBarIcon: ({ color }) => <CalendarDays size={22} color={color} /> }} />
      <Tabs.Screen name="fleet" options={{ title: 'Fleet', tabBarIcon: ({ color }) => <Truck size={22} color={color} /> }} />
      <Tabs.Screen name="finance" options={{ title: 'Finance', tabBarIcon: ({ color }) => <CreditCard size={22} color={color} /> }} />
      <Tabs.Screen name="messages" options={{ title: 'Inbox', tabBarIcon: ({ color }) => <MessagesSquare size={22} color={color} /> }} />
    </Tabs>
  );
}
