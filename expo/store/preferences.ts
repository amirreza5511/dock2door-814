import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CURRENCY_CODES, type UnitSystem } from '@/constants/world';

const CURRENCY_KEY = 'd2d_pref_currency';
const UNITS_KEY = 'd2d_pref_units';
const INTRO_SEEN_KEY = 'd2d_pref_intro_seen';

const DEFAULT_CURRENCY = 'USD';
const DEFAULT_UNITS: UnitSystem = 'metric';

function isUnitSystem(v: string): v is UnitSystem {
  return v === 'metric' || v === 'imperial';
}

interface PreferencesState {
  currency: string;
  unitSystem: UnitSystem;
  hydrated: boolean;
  /** True once the launch promo video has been seen (or skipped). */
  introSeen: boolean;
  /** Load saved preferences from storage. Safe to call multiple times. */
  hydrate: () => Promise<void>;
  setCurrency: (code: string) => void;
  setUnitSystem: (system: UnitSystem) => void;
  /** Mark the promo video as seen so it won't auto-play again. */
  markIntroSeen: () => void;
  /** Reset so the promo video plays again (e.g. "Watch intro" in settings). */
  replayIntro: () => void;
}

/**
 * Persisted global preferences (display currency + metric/imperial units).
 * Kept separate from auth so it survives sign-out and works for guests.
 */
export const usePreferences = create<PreferencesState>()((set, get) => ({
  currency: DEFAULT_CURRENCY,
  unitSystem: DEFAULT_UNITS,
  hydrated: false,
  introSeen: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const [cur, units, intro] = await Promise.all([
        AsyncStorage.getItem(CURRENCY_KEY),
        AsyncStorage.getItem(UNITS_KEY),
        AsyncStorage.getItem(INTRO_SEEN_KEY),
      ]);
      set({
        currency: cur && CURRENCY_CODES.includes(cur) ? cur : DEFAULT_CURRENCY,
        unitSystem: units && isUnitSystem(units) ? units : DEFAULT_UNITS,
        introSeen: intro === 'true',
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },

  markIntroSeen: () => {
    set({ introSeen: true });
    void AsyncStorage.setItem(INTRO_SEEN_KEY, 'true').catch(() => {});
  },

  replayIntro: () => {
    set({ introSeen: false });
    void AsyncStorage.removeItem(INTRO_SEEN_KEY).catch(() => {});
  },

  setCurrency: (code) => {
    set({ currency: code });
    void AsyncStorage.setItem(CURRENCY_KEY, code).catch(() => {});
  },

  setUnitSystem: (system) => {
    set({ unitSystem: system });
    void AsyncStorage.setItem(UNITS_KEY, system).catch(() => {});
  },
}));
