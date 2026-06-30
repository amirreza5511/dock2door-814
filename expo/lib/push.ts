import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';

/**
 * Real push-notification registration.
 *
 * Obtains the device's Expo push token and stores it in `push_tokens` via the
 * `register_push_token` RPC. The backend `push-notifications` edge function then
 * delivers queued notifications (shift invitations, matches, messages, etc.) to
 * these tokens — so a worker hears about a new shift even when the app is closed.
 *
 * Best-effort and fully defensive: never throws, no-op on web, and silently
 * skips when permission is denied or a push token can't be minted (e.g. inside a
 * simulator without a real device).
 */

let lastRegisteredToken: string | null = null;

function resolveProjectId(): string | undefined {
  const easId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return easId ?? process.env.EXPO_PUBLIC_PROJECT_ID ?? undefined;
}

/**
 * Register this device for push notifications for the signed-in user.
 * Safe to call repeatedly — it only re-registers when the token changes.
 */
export async function registerPushTokenAsync(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const perm = await Notifications.getPermissionsAsync();
    let granted = perm.granted;
    if (!granted && perm.canAskAgain) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) return;

    const projectId = resolveProjectId();
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResponse.data;
    if (!token || token === lastRegisteredToken) return;

    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS,
      p_device_id: Constants.sessionId ?? Platform.OS,
    });
    if (error) {
      console.log('[push] register_push_token failed (non-blocking):', error.message);
      return;
    }
    lastRegisteredToken = token;
  } catch (e) {
    // Simulators / missing EAS projectId / network — never block the app.
    console.log('[push] token registration skipped:', e instanceof Error ? e.message : 'unknown');
  }
}
