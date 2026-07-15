import { Platform } from 'react-native';

/**
 * Base URL of the public web app that hosts the shareable tracking page.
 * Configurable via EXPO_PUBLIC_WEB_URL; falls back to the production domain.
 * On web we always use the current origin so links stay on the same host.
 */
const FALLBACK_WEB_URL = 'https://dock2door.app';

export function webBaseUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  const env = process.env.EXPO_PUBLIC_WEB_URL;
  return (env && env.trim()) || FALLBACK_WEB_URL;
}

/** Public tracking URL for a load token, e.g. https://dock2door.app/t/<token>. */
export function trackUrl(token: string): string {
  return `${webBaseUrl().replace(/\/+$/, '')}/t/${token}`;
}
