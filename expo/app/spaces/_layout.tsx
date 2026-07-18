import { Stack } from 'expo-router';
import C from '@/constants/colors';

/**
 * Shared warehouse-space rental area. Lives at the top level so every role
 * (customers, shippers, forwarders, employers, guests, …) can rent square
 * footage from warehouse providers — like shared/flex space for warehousing.
 */
export default function SpacesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade' }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
