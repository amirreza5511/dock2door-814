import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, usePathname, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/store/auth';
import { canAccessSegment, getRoleRoute } from '@/lib/access';
import { trpc, trpcClient } from '@/lib/trpc';
import C from '@/constants/colors';
import { ActiveCompanyProvider } from '@/providers/ActiveCompanyProvider';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();
const PUBLIC_SEGMENTS = ['', 'auth', '+not-found'];
const SHARED_SEGMENTS = ['fulfillment', 'messages', 'notifications', 'reviews'];

function AuthGuard() {
  const { user, isHydrated } = useAuthStore();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const isNavigationReady = Boolean(rootNavigationState?.key);

  useEffect(() => {
    if (!isHydrated || !isNavigationReady) {
      return;
    }

    const root = segments[0] ?? '';
    const isPublic = PUBLIC_SEGMENTS.includes(root as string);
    let destination: string | null = null;

    if (!user) {
      if (!isPublic && pathname !== '/') {
        destination = '/';
      }
    } else if (isPublic) {
      destination = user.isPlatformAdmin ? '/admin' : getRoleRoute(user.role);
    } else if (!SHARED_SEGMENTS.includes(root) && !canAccessSegment(user.role, root, Boolean(user.isPlatformAdmin))) {
      destination = user.isPlatformAdmin ? '/admin' : getRoleRoute(user.role);
    }

    if (!destination || destination === pathname) {
      return;
    }

    requestAnimationFrame(() => {
      router.replace(destination as never);
    });
  }, [isHydrated, isNavigationReady, pathname, router, segments, user]);

  return null;
}

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: C.bg },
        animation: 'fade',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="auth" />
      <Stack.Screen name="customer" />
      <Stack.Screen name="warehouse-provider" />
      <Stack.Screen name="service-provider" />
      <Stack.Screen name="employer" />
      <Stack.Screen name="worker" />
      <Stack.Screen name="trucking-company" />
      <Stack.Screen name="driver" />
      <Stack.Screen name="gate-staff" />
      <Stack.Screen name="admin" />
      <Stack.Screen name="super-admin" />
      <Stack.Screen name="fulfillment" />
      <Stack.Screen name="messages" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="reviews" />
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

function BootstrapController() {
  const authBootstrap = useAuthStore((state) => state.bootstrap);
  const isHydrated = useAuthStore((state) => state.isHydrated);

  useEffect(() => {
    void authBootstrap();
  }, [authBootstrap]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void SplashScreen.hideAsync();
  }, [isHydrated]);

  return null;
}

export default function RootLayout() {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ActiveCompanyProvider>
          <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.bg }}>
            <StatusBar style="light" />
            <RootLayoutNav />
            <BootstrapController />
            <AuthGuard />
          </GestureHandlerRootView>
        </ActiveCompanyProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
