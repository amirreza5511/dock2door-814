import { Stack } from 'expo-router';
import C from '@/constants/colors';

export default function FreightForwarderLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[orderId]" />
      <Stack.Screen name="rates" />
      <Stack.Screen name="invoicing" />
      <Stack.Screen name="ocean" />
      <Stack.Screen name="air" />
    </Stack>
  );
}
