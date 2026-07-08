import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, ShieldCheck, FileText } from 'lucide-react-native';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import LegalDocSheet from '@/components/LegalDocSheet';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import {
  TERMS_AND_CONDITIONS, NDA_AGREEMENT, TERMS_VERSION, NDA_VERSION, type LegalDoc,
} from '@/constants/legal';

interface AcceptanceRow {
  doc_type: string;
  doc_version: string;
}
interface LegalStatus {
  terms: AcceptanceRow | null;
  nda: AcceptanceRow | null;
}

/**
 * Blocks the app for signed-in users who have not yet accepted the current
 * Terms & Conditions and Non-Disclosure Agreement. Existing users who
 * registered before legal acceptance was required will land here on next
 * launch, sign once, and never see it again (until a version bumps).
 */
export default function LegalGate() {
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  const statusQuery = useQuery<LegalStatus>({
    queryKey: ['legal-status', userId],
    enabled: Boolean(userId) && isHydrated,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_legal_status');
      if (error) throw error;
      const parsed = (data ?? {}) as Partial<LegalStatus>;
      return { terms: parsed.terms ?? null, nda: parsed.nda ?? null };
    },
  });

  const status = statusQuery.data;
  const needsTerms = useMemo(
    () => Boolean(status) && (!status?.terms || status.terms.doc_version !== TERMS_VERSION),
    [status],
  );
  const needsNda = useMemo(
    () => Boolean(status) && (!status?.nda || status.nda.doc_version !== NDA_VERSION),
    [status],
  );

  const [acceptedTerms, setAcceptedTerms] = useState<boolean>(false);
  const [acceptedNda, setAcceptedNda] = useState<boolean>(false);
  const [signedName, setSignedName] = useState<string>('');
  const [viewingDoc, setViewingDoc] = useState<LegalDoc | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const canSubmit =
    (!needsTerms || acceptedTerms) &&
    (!needsNda || (acceptedNda && signedName.trim().length > 0));

  const submit = useCallback(async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      if (needsTerms) {
        const { error: e } = await supabase.rpc('record_legal_acceptance', {
          p_doc_type: 'terms',
          p_doc_version: TERMS_VERSION,
          p_signed_name: signedName.trim(),
          p_platform: Platform.OS,
        });
        if (e) throw e;
      }
      if (needsNda) {
        const { error: e } = await supabase.rpc('record_legal_acceptance', {
          p_doc_type: 'nda',
          p_doc_version: NDA_VERSION,
          p_signed_name: signedName.trim(),
          p_platform: Platform.OS,
        });
        if (e) throw e;
      }
      await statusQuery.refetch();
    } catch (err) {
      console.log('[LegalGate] submit failed', err instanceof Error ? err.message : String(err));
      setError('Could not save your acceptance. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, submitting, needsTerms, needsNda, signedName, statusQuery]);

  // Nothing to show: no user, still loading, query errored, or already accepted.
  if (!userId || !isHydrated) return null;
  if (!status) return null;
  if (!needsTerms && !needsNda) return null;

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <LinearGradient colors={['#0B1727', C.bg]} style={StyleSheet.absoluteFill} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.badge}><ShieldCheck size={26} color={C.accent} /></View>
        <Text style={styles.title}>One quick step before you continue</Text>
        <Text style={styles.subtitle}>
          We&apos;ve updated our agreements. To keep using Dock2Door, please review and accept the documents below. This only takes a moment.
        </Text>

        {needsTerms ? (
          <View style={styles.block}>
            <TouchableOpacity style={styles.docRow} onPress={() => setViewingDoc(TERMS_AND_CONDITIONS)} activeOpacity={0.8}>
              <FileText size={18} color={C.accent} />
              <Text style={styles.docRowText}>Read the Terms &amp; Conditions</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAcceptedTerms((v) => !v)} activeOpacity={0.8} style={styles.checkRow} testID="gate-accept-terms">
              <View style={[styles.checkbox, acceptedTerms && styles.checkboxOn]}>{acceptedTerms ? <Check size={14} color={C.white} /> : null}</View>
              <Text style={styles.checkText}>{TERMS_AND_CONDITIONS.summary}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {needsNda ? (
          <View style={styles.block}>
            <TouchableOpacity style={styles.docRow} onPress={() => setViewingDoc(NDA_AGREEMENT)} activeOpacity={0.8}>
              <FileText size={18} color={C.accent} />
              <Text style={styles.docRowText}>Read the Non-Disclosure Agreement</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAcceptedNda((v) => !v)} activeOpacity={0.8} style={styles.checkRow} testID="gate-accept-nda">
              <View style={[styles.checkbox, acceptedNda && styles.checkboxOn]}>{acceptedNda ? <Check size={14} color={C.white} /> : null}</View>
              <Text style={styles.checkText}>{NDA_AGREEMENT.summary}</Text>
            </TouchableOpacity>
            {acceptedNda ? (
              <Input
                label="Type your full legal name to sign"
                value={signedName}
                onChangeText={setSignedName}
                placeholder="e.g. Jane A. Smith"
                autoCapitalize="words"
                testID="gate-nda-signature"
              />
            ) : null}
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          label={submitting ? 'Saving…' : 'Agree & continue'}
          onPress={() => void submit()}
          fullWidth
          size="lg"
          disabled={!canSubmit || submitting}
          style={styles.submitBtn}
        />
      </ScrollView>

      <LegalDocSheet doc={viewingDoc} visible={viewingDoc !== null} onClose={() => setViewingDoc(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 9999, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 24, gap: 16 },
  badge: { width: 60, height: 60, borderRadius: 18, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: C.textSecondary, lineHeight: 20, marginTop: -4 },
  block: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 16, gap: 12 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  docRowText: { fontSize: 15, fontWeight: '700' as const, color: C.accent },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: C.accent, borderColor: C.accent },
  checkText: { flex: 1, fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  error: { fontSize: 13, color: C.red, fontWeight: '600' as const },
  submitBtn: { marginTop: 4 },
});
