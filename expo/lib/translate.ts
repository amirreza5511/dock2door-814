/**
 * On-demand AI translation for Help Center manual content.
 *
 * Translates batches of short strings into a target language and caches the
 * result (in memory + AsyncStorage) keyed by a content hash, so each unique set
 * of strings is only ever translated once per language.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { askAssistant, type AiMessage } from '@/lib/ai';
import { getLang, type LangCode } from '@/constants/i18n';

const CACHE_VERSION = 'v1';
const memoryCache = new Map<string, string[]>();

/** Small, fast, stable string hash (djb2) used as a cache key. */
function hashStrings(parts: string[]): string {
  const joined = parts.join('\u0001');
  let h = 5381;
  for (let i = 0; i < joined.length; i += 1) {
    h = ((h << 5) + h + joined.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function cacheKey(lang: LangCode, texts: string[]): string {
  return `d2d_tr_${CACHE_VERSION}_${lang}_${hashStrings(texts)}`;
}

function stripFences(raw: string): string {
  return raw
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function parseArray(raw: string, expectedLength: number): string[] | null {
  try {
    const parsed = JSON.parse(stripFences(raw)) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length === expectedLength &&
      parsed.every((x) => typeof x === 'string')
    ) {
      return parsed as string[];
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Translate an ordered list of strings into `lang`.
 * Returns the original list for English, on cache hit returns instantly, and on
 * any failure falls back to the original strings so the UI never breaks.
 */
export async function translateBatch(texts: string[], lang: LangCode): Promise<string[]> {
  if (lang === 'en' || texts.length === 0) return texts;

  const key = cacheKey(lang, texts);

  const inMemory = memoryCache.get(key);
  if (inMemory) return inMemory;

  try {
    const stored = await AsyncStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed) && parsed.length === texts.length) {
        const arr = parsed as string[];
        memoryCache.set(key, arr);
        return arr;
      }
    }
  } catch {
    // ignore cache read errors
  }

  const languageName = getLang(lang).aiName;
  const messages: AiMessage[] = [
    {
      role: 'system',
      content:
        `You are a professional UI localizer. Translate each string in the user's JSON array into ${languageName}. ` +
        `Keep the meaning natural and concise for a mobile logistics app. Do NOT translate brand names (Dock2Door, Stripe) or product terms like "WMS". ` +
        `Preserve any "{n}" placeholders exactly. Return ONLY a JSON array of strings with the SAME length and order as the input — no comments, no markdown.`,
    },
    { role: 'user', content: JSON.stringify(texts) },
  ];

  try {
    const reply = await askAssistant(messages);
    const arr = parseArray(reply, texts.length);
    if (arr) {
      memoryCache.set(key, arr);
      void AsyncStorage.setItem(key, JSON.stringify(arr)).catch(() => {});
      return arr;
    }
  } catch {
    // network / model failure — fall back to source strings
  }

  return texts;
}
