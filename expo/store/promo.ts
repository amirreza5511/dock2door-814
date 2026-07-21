import { create } from 'zustand';

/**
 * Drives the full-screen promo / intro player.
 *
 * The intro doubles as an ad surface: it plays on every launch and again as an
 * "attract loop" whenever the user goes idle, so promo/ad slots get repeat
 * impressions. `active` lets the idle watcher avoid re-triggering while it plays.
 */
interface PromoState {
  /** Bumped each time we want the player to (re)start from the first scene. */
  playToken: number;
  /** True while the promo player is on screen. */
  active: boolean;
  /** Request a play (launch, idle attract, or "watch again"). */
  play: () => void;
  setActive: (v: boolean) => void;
}

export const usePromo = create<PromoState>()((set) => ({
  playToken: 0,
  active: false,
  play: () => set((s) => (s.active ? s : { playToken: s.playToken + 1 })),
  setActive: (v) => set({ active: v }),
}));
