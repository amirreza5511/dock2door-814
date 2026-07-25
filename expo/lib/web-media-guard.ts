import { Platform } from 'react-native';

/**
 * Web-only guard against benign media autoplay rejections.
 *
 * Browsers reject a pending `play()` promise when a muted background video is
 * paused to save power, its source is swapped mid-load, or autoplay policy
 * kicks in. These are harmless for our decorative intro/ad videos, but if the
 * rejection happens inside the video library's own internal play() calls it
 * surfaces as an unhandled rejection and trips the runtime-error overlay.
 *
 * This module patches HTMLMediaElement.prototype.play so those specific
 * rejections are caught at the source (they can never become unhandled), and
 * adds a window-level unhandledrejection fallback for the same messages.
 * All other errors pass through untouched. Import once, as early as possible.
 */

const BENIGN_MEDIA_ERROR =
  /play\(\) request was interrupted|interrupted by a new load request|media was paused|paused to save power|background media was paused|NotAllowedError|The operation was aborted/i;

function isBenign(reason: unknown): boolean {
  const msg =
    typeof reason === 'object' && reason !== null
      ? String((reason as { message?: unknown }).message ?? '')
      : String(reason ?? '');
  return BENIGN_MEDIA_ERROR.test(msg);
}

declare global {
  // eslint-disable-next-line no-var
  var __d2dMediaGuardInstalled: boolean | undefined;
}

if (
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  !globalThis.__d2dMediaGuardInstalled
) {
  globalThis.__d2dMediaGuardInstalled = true;

  try {
    const proto = (window as unknown as { HTMLMediaElement?: { prototype: HTMLMediaElement } })
      .HTMLMediaElement?.prototype;
    if (proto && typeof proto.play === 'function') {
      const originalPlay = proto.play;
      proto.play = function patchedPlay(this: HTMLMediaElement): Promise<void> {
        const result = originalPlay.apply(this);
        if (result && typeof result.catch === 'function') {
          return result.catch((err: unknown) => {
            if (isBenign(err)) return undefined;
            throw err;
          });
        }
        return result;
      };
    }
  } catch {
    // Never let the guard itself break startup.
  }

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    if (isBenign(e?.reason)) e.preventDefault();
  });
}

export {};
