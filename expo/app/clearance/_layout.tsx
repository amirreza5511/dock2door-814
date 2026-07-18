import { Stack } from 'expo-router';
import C from '@/constants/colors';

/**
 * Shared customs-clearance area. Lives at the top level so every business role
 * (freight forwarders, customers, shippers, drayage companies, trucking, guests)
 * can request clearance from a licensed customs broker.
 */
export default function ClearanceLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[requestId]" />
    </Stack>
  );
}
