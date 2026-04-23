import { Stack } from 'expo-router';
import C from '@/constants/colors';

export default function ReviewsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade' }}>
      <Stack.Screen name="company/[companyId]" />
      <Stack.Screen name="worker/[userId]" />
    </Stack>
  );
}
