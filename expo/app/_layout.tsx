import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, usePathname, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useCallback, useEffect, useRef } from 'react';
import { KeyboardAvoidingView, PanResponder, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/store/auth';
import { usePreferences } from '@/store/preferences';
import { canAccessSegment, DOMAIN_BY_ROLE, ENABLE_DOMAINS, getRoleRoute, visibleDomains } from '@/lib/access';
import { trpc, trpcClient } from '@/lib/trpc';
import C from '@/constants/colors';
import { ActiveCompanyProvider } from '@/providers/ActiveCompanyProvider';
import { CurrentWorldProvider } from '@/providers/CurrentWorldProvider';
import { CustomizationProvider } from '@/providers/CustomizationProvider';
import { registerPushTokenAsync } from '@/lib/push';
import AdBanner from '@/components/AdBanner';
import AiFab from '@/components/AiFab';
import LegalGate from '@/components/LegalGate';
import ExploreBanner from '@/components/ExploreBanner';
import ActionGate from '@/components/ActionGate';
import IntroVideo from '@/components/IntroVideo';
import { usePromo } from '@/store/promo';
import { useExploreStore } from '@/store/explore';

/** After this much inactivity, replay the promo as an ad "attract loop". */
const IDLE_ATTRACT_MS = 90000;

/**
 * Wraps the app content and replays the promo/ad reel whenever the user goes
 * idle. Touches are detected via a non-capturing PanResponder so they still
 * pass through to the UI underneath.
 */
function IdleAttract({ children }: { children: React.ReactNode }) {
  const play = usePromo((s) => s.play);
  const active = usePromo((s) => s.active);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!usePromo.getState().active) play();
    }, IDLE_ATTRACT_MS);
  }, [play]);

  useEffect(() => {
    reset();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [reset]);

  // Restart the countdown once an attract play finishes.
  useEffect(() => {
    if (!active) reset();
  }, [active, reset]);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => { reset(); return false; },
      onMoveShouldSetPanResponderCapture: () => { reset(); return false; },
    }),
  ).current;

  return <View style={{ flex: 1 }} {...responder.panHandlers}>{children}</View>;
}

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();
const PUBLIC_SEGMENTS = ['', 'auth', '+not-found', 'explore', 'directory', 'ship'];

type ReactCreateElement = typeof React.createElement;
type ReactRuntimeWithGuard = typeof React & { __dock2doorTextNodeGuard?: boolean };

// Containers that cannot have raw string/number children in React Native
const UNSAFE_CONTAINERS = new Set<unknown>();

const sanitizeChild = (child: unknown, index: number): React.ReactNode => {
  if (typeof child !== 'string' && typeof child !== 'number') return child as React.ReactNode;
  const value = String(child);
  if (value.trim().length === 0) return null;
  // Wrap bare text in a Text component so it renders safely
  return React.createElement(Text, { key: `safe-text-${index}` }, value);
};

const sanitizeChildren = (children: unknown): unknown => {
  if (Array.isArray(children)) {
    return children.map((c, i) => sanitizeChild(c, i));
  }
  return sanitizeChild(children, 0);
};

const installTextNodeGuard = () => {
  const reactRuntime = React as ReactRuntimeWithGuard;
  if (reactRuntime.__dock2doorTextNodeGuard) return;

  // Populate after imports are resolved
  [View, ScrollView, TouchableOpacity, Pressable, KeyboardAvoidingView, GestureHandlerRootView]
    .forEach((c) => UNSAFE_CONTAINERS.add(c));

  // ── 1. Classic JSX transform: React.createElement(type, props, ...children) ──
  const originalCreateElement: ReactCreateElement = React.createElement.bind(React);
  React.createElement = ((type: Parameters<ReactCreateElement>[0], props: Parameters<ReactCreateElement>[1], ...children: React.ReactNode[]) => {
    if (UNSAFE_CONTAINERS.has(type) && children.length > 0) {
      const safe = children.map((child, i) => sanitizeChild(child, i));
      return originalCreateElement(type, props, ...safe);
    }
    return originalCreateElement(type, props, ...children);
  }) as ReactCreateElement;

  // ── 2. Automatic JSX transform: jsx/jsxs pass children via props ──
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jsr = require('react/jsx-runtime') as { jsx: Function; jsxs: Function };
    const origJsx = jsr.jsx;
    const origJsxs = jsr.jsxs;

    jsr.jsx = (type: unknown, props: Record<string, unknown> | null, key?: unknown) => {
      if (UNSAFE_CONTAINERS.has(type) && props != null && 'children' in props) {
        props = { ...props, children: sanitizeChildren(props.children) };
      }
      return origJsx(type, props, key);
    };

    jsr.jsxs = (type: unknown, props: Record<string, unknown> | null, key?: unknown) => {
      if (UNSAFE_CONTAINERS.has(type) && props != null && 'children' in props) {
        props = { ...props, children: sanitizeChildren(props.children) };
      }
      return origJsxs(type, props, key);
    };
  } catch {
    // react/jsx-runtime not available (older RN); classic createElement patch above is enough
  }

  reactRuntime.__dock2doorTextNodeGuard = true;
};

installTextNodeGuard();
const SHARED_SEGMENTS = ['messages', 'notifications', 'reviews', 'onboarding', 'help', 'permissions', 'device-tools', 'advertise', 'partners', 'company'];

function AuthGuard() {
  const { user, isHydrated } = useAuthStore();
  const isExploring = useExploreStore((s) => s.isExploring);
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
      // Explore mode lets a guest browse real role dashboards with sample data.
      // Guests may also open the Help center + AI assistant (informational, non-sensitive).
      const guestAllowed = isPublic || root === 'help';
      if (!guestAllowed && pathname !== '/' && !isExploring) {
        destination = '/';
      }
    } else if (isPublic) {
      destination = resolveHome(user);
    } else if (!SHARED_SEGMENTS.includes(root) && !canAccessSegment(user.role, root, Boolean(user.isPlatformAdmin))) {
      destination = resolveHome(user);
    }

    if (!destination || destination === pathname) {
      return;
    }

    requestAnimationFrame(() => {
      router.replace(destination as never);
    });
  }, [isHydrated, isNavigationReady, pathname, router, segments, user, isExploring]);

  return null;
}

/**
 * Computes the post-login landing route. World-aware when ENABLE_DOMAINS is on:
 * single-world users go to their role home, admins go to the shared admin layer.
 * Falls back to the original role-based redirect when the flag is off.
 */
function resolveHome(user: NonNullable<ReturnType<typeof useAuthStore.getState>['user']>): string {
  const adminHome = user.role === 'SuperAdmin' ? '/super-admin' : user.isPlatformAdmin ? '/admin' : null;
  if (!ENABLE_DOMAINS) {
    return adminHome ?? getRoleRoute(user.role);
  }
  if (adminHome) {
    return adminHome;
  }
  // Non-admin roles always belong to exactly one world; route to that role's home.
  const worlds = visibleDomains(user);
  if (worlds.length > 0 && DOMAIN_BY_ROLE[user.role]) {
    return getRoleRoute(user.role);
  }
  return getRoleRoute(user.role);
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
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

function BootstrapController() {
  const authBootstrap = useAuthStore((state) => state.bootstrap);
  const isHydrated = useAuthStore((state) => state.isHydrated);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const hydratePreferences = usePreferences((state) => state.hydrate);
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    void authBootstrap();
    void hydratePreferences();
  }, [authBootstrap, hydratePreferences]);

  // Wipe ALL cached server data whenever the signed-in user changes (login,
  // logout, or account switch) so one account never sees another account's
  // cached queries (chat history, context, lists, ...).
  useEffect(() => {
    if (prevUserIdRef.current === undefined) {
      prevUserIdRef.current = userId;
      return;
    }
    if (prevUserIdRef.current !== userId) {
      prevUserIdRef.current = userId;
      queryClient.clear();
    }
  }, [userId]);

  // Register this device for push notifications once a user is signed in, so the
  // backend can deliver shift invitations/matches/messages even when the app is closed.
  useEffect(() => {
    if (!userId) return;
    void registerPushTokenAsync();
  }, [userId]);

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
    <QueryClientProvider client={queryClient}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <ActiveCompanyProvider>
          <CurrentWorldProvider>
            <CustomizationProvider>
            <SafeAreaProvider>
              <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.bg }}>
                <StatusBar style="light" />
                <IdleAttract>
                  <RootLayoutNav />
                </IdleAttract>
                <AiFab />
                <AdBanner />
                <ExploreBanner />
                <ActionGate />
                <IntroVideo />
                <BootstrapController />
                <AuthGuard />
                <LegalGate />
              </GestureHandlerRootView>
            </SafeAreaProvider>
            </CustomizationProvider>
          </CurrentWorldProvider>
        </ActiveCompanyProvider>
      </trpc.Provider>
    </QueryClientProvider>
  );
}
