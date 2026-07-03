import { Stack } from 'expo-router';
import C from '@/constants/colors';

export default function DrayageCompanyLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="board" />
      <Stack.Screen name="terminals" />
      <Stack.Screen name="[orderId]" />
    </Stack>
  );
}
