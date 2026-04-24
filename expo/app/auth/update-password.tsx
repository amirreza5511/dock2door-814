import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '@/store/auth';
import { supabase } from '@/lib/supabase';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';

export default function UpdatePassword() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const updatePassword = useAuthStore((s) => s.updatePassword);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setHasSession(Boolean(data.session?.user));
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[UpdatePassword] auth event', event);
      if (session?.user) setHasSession(true);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  const handleSubmit = async () => {
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const result = await updatePassword(password);
      if (result.success) {
        router.replace('/auth/login' as any);
      } else {
        setError(result.error ?? 'Failed to update password');
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
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        <LinearGradient colors={['#0D1E35', C.bg]} style={styles.heroBg} />

        <View style={styles.header}>
          <Text style={styles.title}>Set a new password</Text>
          <Text style={styles.subtitle}>
            {hasSession
              ? 'Choose a strong password you haven\'t used before.'
              : 'Open the reset link from your email on this device. It signs you in temporarily so you can set a new password.'}
          </Text>
        </View>

        {hasSession ? (
          <View style={styles.form}>
            <Input
              label="New password"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
              secureTextEntry
              testID="input-password"
            />
            <Input
              label="Confirm password"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Repeat password"
              secureTextEntry
              testID="input-confirm"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              label="Update password"
              onPress={handleSubmit}
              loading={loading}
              fullWidth
              size="lg"
            />
          </View>
        ) : (
          <View style={styles.form}>
            <Button
              label="Back to sign in"
              onPress={() => router.replace('/auth/login' as any)}
              fullWidth
              variant="secondary"
            />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },
  header: { marginBottom: 28 },
  title: { fontSize: 30, fontWeight: '800' as const, color: C.text, letterSpacing: -0.8, marginBottom: 8 },
  subtitle: { fontSize: 15, color: C.textSecondary, lineHeight: 22 },
  form: { gap: 16 },
  error: { fontSize: 13, color: C.red, textAlign: 'center' },
});
