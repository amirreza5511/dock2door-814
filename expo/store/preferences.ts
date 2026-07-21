import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CURRENCY_CODES, type UnitSystem } from '@/constants/world';

const CURRENCY_KEY = 'd2d_pref_currency';
const UNITS_KEY = 'd2d_pref_units';

const DEFAULT_CURRENCY = 'USD';
const DEFAULT_UNITS: UnitSystem = 'metric';

function isUnitSystem(v: string): v is UnitSystem {
  return v === 'metric' || v === 'imperial';
}

interface PreferencesState {
  currency: string;
  unitSystem: UnitSystem;
  hydrated: boolean;
  /** Load saved preferences from storage. Safe to call multiple times. */
  hydrate: () => Promise<void>;
  setCurrency: (code: string) => void;
  setUnitSystem: (system: UnitSystem) => void;
}

/**
 * Persisted global preferences (display currency + metric/imperial units).
 * Kept separate from auth so it survives sign-out and works for guests.
 */
export const usePreferences = create<PreferencesState>()((set, get) => ({
  currency: DEFAULT_CURRENCY,
  unitSystem: DEFAULT_UNITS,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const [cur, units] = await Promise.all([
        AsyncStorage.getItem(CURRENCY_KEY),
        AsyncStorage.getItem(UNITS_KEY),
      ]);
      set({
        currency: cur && CURRENCY_CODES.includes(cur) ? cur : DEFAULT_CURRENCY,
        unitSystem: units && isUnitSystem(units) ? units : DEFAULT_UNITS,
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
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
