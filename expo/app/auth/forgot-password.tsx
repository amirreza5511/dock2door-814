import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Mail, Sparkles } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';

export default function ForgotPassword() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const sendPasswordReset = useAuthStore((s) => s.sendPasswordReset);
  const sendMagicLink = useAuthStore((s) => s.sendMagicLink);

  const [email, setEmail] = useState('');
  const [mode, setMode] = useState<'reset' | 'magic'>('reset');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    setError('');
    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }
    setLoading(true);
    try {
      const result = mode === 'reset'
        ? await sendPasswordReset(email.trim())
        : await sendMagicLink(email.trim());
      if (result.success) {
        setSent(true);
      } else {
        setError(result.error ?? 'Failed to send email');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient colors={['#0D1E35', C.bg]} style={styles.heroBg} />

        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="back-btn">
          <ArrowLeft size={20} color={C.textSecondary} />
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.title}>Can't sign in?</Text>
          <Text style={styles.subtitle}>
            Choose how to recover access to your account.
          </Text>
        </View>

        <View style={styles.tabs}>
          <TouchableOpacity
            onPress={() => { setMode('reset'); setSent(false); setError(''); }}
            style={[styles.tab, mode === 'reset' && styles.tabActive]}
            testID="tab-reset"
          >
            <Mail size={16} color={mode === 'reset' ? C.text : C.textSecondary} />
            <Text style={[styles.tabText, mode === 'reset' && styles.tabTextActive]}>Reset password</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setMode('magic'); setSent(false); setError(''); }}
            style={[styles.tab, mode === 'magic' && styles.tabActive]}
            testID="tab-magic"
          >
            <Sparkles size={16} color={mode === 'magic' ? C.text : C.textSecondary} />
            <Text style={[styles.tabText, mode === 'magic' && styles.tabTextActive]}>Magic link</Text>
          </TouchableOpacity>
        </View>

        {sent ? (
          <View style={styles.successCard}>
            <Text style={styles.successTitle}>Check your inbox</Text>
            <Text style={styles.successBody}>
              {mode === 'reset'
                ? `We've sent a password reset link to ${email}. The link expires in 1 hour.`
                : `We've sent a one-time sign-in link to ${email}. Open it on this device to sign in.`}
            </Text>
            <Text style={styles.successHint}>
              Didn't get it? Check spam, or wait a minute and try again. Supabase rate-limits emails when default SMTP is used.
            </Text>
            <Button label="Back to sign in" onPress={() => router.replace('/auth/login' as any)} fullWidth />
          </View>
        ) : (
          <View style={styles.form}>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@company.ca"
              keyboardType="email-address"
              autoCapitalize="none"
              testID="input-email"
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button
              label={mode === 'reset' ? 'Send reset link' : 'Send magic link'}
              onPress={handleSend}
              loading={loading}
              fullWidth
              size="lg"
            />

            <TouchableOpacity onPress={() => router.replace('/auth/login' as any)} style={styles.switchRow}>
              <Text style={styles.switchText}>Remembered it? </Text>
              <Text style={styles.switchLink}>Sign in</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },
  back: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
  header: { marginBottom: 28 },
  title: { fontSize: 30, fontWeight: '800' as const, color: C.text, letterSpacing: -0.8, marginBottom: 8 },
  subtitle: { fontSize: 15, color: C.textSecondary, lineHeight: 22 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 24, padding: 4, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, borderRadius: 8 },
  tabActive: { backgroundColor: C.bg },
  tabText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  tabTextActive: { color: C.text },
  form: { gap: 16 },
  error: { fontSize: 13, color: C.red, textAlign: 'center' },
  switchRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 4 },
  switchText: { fontSize: 14, color: C.textSecondary },
  switchLink: { fontSize: 14, color: C.accent, fontWeight: '600' as const },
  successCard: { padding: 20, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, gap: 12 },
  successTitle: { fontSize: 20, fontWeight: '700' as const, color: C.text },
  successBody: { fontSize: 14, color: C.textSecondary, lineHeight: 21 },
  successHint: { fontSize: 12, color: C.textMuted, lineHeight: 18, marginBottom: 8 },
});
