import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LangCode } from '@/constants/i18n';
import { translateBatch } from '@/lib/translate';

interface TranslatorResult {
  /** Returns the translation of an English source string, or the source while loading. */
  tx: (source: string) => string;
  /** True while a translation request is in flight. */
  loading: boolean;
}

/**
 * Translates an ordered list of English source strings into `lang` and returns a
 * lookup function `tx(source)`. English is a no-op. Results are cached, so once a
 * given screen/role has been translated it shows instantly on the next visit.
 */
export function useTranslator(texts: string[], lang: LangCode): TranslatorResult {
  const [map, setMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<boolean>(false);

  // Stable trigger: only re-run when the actual content or language changes.
  const signature = useMemo(() => texts.join('\u0001'), [texts]);

  useEffect(() => {
    if (lang === 'en') {
      setMap({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    translateBatch(texts, lang)
      .then((translated) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        texts.forEach((t, i) => {
          const value = translated[i];
          if (typeof value === 'string' && value.length > 0) next[t] = value;
        });
        setMap(next);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setMap({});
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `signature` captures the contents of `texts`; re-running on the array
    // identity itself would loop since a new array is created every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, lang]);

  const tx = useCallback((source: string) => map[source] ?? source, [map]);

  return { tx, loading };
}
