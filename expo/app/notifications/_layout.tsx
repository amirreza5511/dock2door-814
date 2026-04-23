import { Stack } from 'expo-router';
import C from '@/constants/colors';

export default function NotificationsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="preferences" />
    </Stack>
  );
}
