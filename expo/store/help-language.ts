import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_LANG, isLangCode, type LangCode } from '@/constants/i18n';

const STORAGE_KEY = 'd2d_help_lang';

interface HelpLanguageState {
  lang: LangCode;
  hydrated: boolean;
  /** Load the saved language from storage. Safe to call multiple times. */
  hydrate: () => Promise<void>;
  setLang: (lang: LangCode) => void;
}

/**
 * Persisted language preference for the Help Center (manual + AI chat).
 * Kept separate from auth so it survives sign-out and works for guests.
 */
export const useHelpLanguage = create<HelpLanguageState>()((set, get) => ({
  lang: DEFAULT_LANG,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored && isLangCode(stored)) {
        set({ lang: stored, hydrated: true });
      } else {
        set({ hydrated: true });
      }
    } catch {
      set({ hydrated: true });
    }
  },

  setLang: (lang) => {
    set({ lang });
    void AsyncStorage.setItem(STORAGE_KEY, lang).catch(() => {});
  },
}));
