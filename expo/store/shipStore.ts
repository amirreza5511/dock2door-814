import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ADDRESSES_KEY = 'd2d_ship_addresses';
const HISTORY_KEY = 'd2d_ship_history';
const MAX_HISTORY = 30;

/** A saved sender/recipient address the user can reuse across shipments. */
export interface SavedAddress {
  id: string;
  label: string;
  name: string;
  line1: string;
  city: string;
  postal: string;
  country: string;
  isDefault?: boolean;
}

/** A recorded quote so the user can revisit prices they compared before. */
export interface QuoteHistoryEntry {
  id: string;
  createdAt: number;
  length: number;
  width: number;
  height: number;
  weight: number;
  service: string;
  fromPostal: string;
  toPostal: string;
  toCity: string;
  bestCourier: string;
  bestPrice: number;
  currency: string;
  isLive: boolean;
}

interface ShipStoreState {
  addresses: SavedAddress[];
  history: QuoteHistoryEntry[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  saveAddress: (a: Omit<SavedAddress, 'id'>) => SavedAddress;
  updateAddress: (id: string, patch: Partial<Omit<SavedAddress, 'id'>>) => void;
  removeAddress: (id: string) => void;
  setDefaultAddress: (id: string) => void;
  addHistory: (e: Omit<QuoteHistoryEntry, 'id' | 'createdAt'>) => void;
  clearHistory: () => void;
}

function genId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function persistAddresses(list: SavedAddress[]): void {
  void AsyncStorage.setItem(ADDRESSES_KEY, JSON.stringify(list)).catch(() => {});
}

function persistHistory(list: QuoteHistoryEntry[]): void {
  void AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(list)).catch(() => {});
}

/**
 * Persisted local store for the Ship & Return section: reusable addresses and
 * a rolling history of the quotes the user has compared. Works for guests too.
 */
export const useShipStore = create<ShipStoreState>()((set, get) => ({
  addresses: [],
  history: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const [rawAddr, rawHist] = await Promise.all([
        AsyncStorage.getItem(ADDRESSES_KEY),
        AsyncStorage.getItem(HISTORY_KEY),
      ]);
      const addresses = rawAddr ? (JSON.parse(rawAddr) as SavedAddress[]) : [];
      const history = rawHist ? (JSON.parse(rawHist) as QuoteHistoryEntry[]) : [];
      set({
        addresses: Array.isArray(addresses) ? addresses : [],
        history: Array.isArray(history) ? history : [],
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },

  saveAddress: (a) => {
    const entry: SavedAddress = { ...a, id: genId() };
    const next = [...get().addresses, entry];
    const normalized = entry.isDefault ? next.map((x) => ({ ...x, isDefault: x.id === entry.id })) : next;
    set({ addresses: normalized });
    persistAddresses(normalized);
    return entry;
  },

  updateAddress: (id, patch) => {
    const next = get().addresses.map((x) => (x.id === id ? { ...x, ...patch } : x));
    set({ addresses: next });
    persistAddresses(next);
  },

  removeAddress: (id) => {
    const next = get().addresses.filter((x) => x.id !== id);
    set({ addresses: next });
    persistAddresses(next);
  },

  setDefaultAddress: (id) => {
    const next = get().addresses.map((x) => ({ ...x, isDefault: x.id === id }));
    set({ addresses: next });
    persistAddresses(next);
  },

  addHistory: (e) => {
    const entry: QuoteHistoryEntry = { ...e, id: genId(), createdAt: Date.now() };
    const next = [entry, ...get().history].slice(0, MAX_HISTORY);
    set({ history: next });
    persistHistory(next);
  },

  clearHistory: () => {
    set({ history: [] });
    persistHistory([]);
  },
}));
