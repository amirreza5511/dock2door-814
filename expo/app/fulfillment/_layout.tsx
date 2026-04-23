import { Stack } from 'expo-router';
import C from '@/constants/colors';

export default function FulfillmentLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade' }}>
      <Stack.Screen name="[bookingId]" />
      <Stack.Screen name="shipments" />
      <Stack.Screen name="returns" />
    </Stack>
  );
}
