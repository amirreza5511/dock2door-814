import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, WifiOff } from 'lucide-react-native';
import { DEMO_ACCOUNTS, type DemoAccount } from '@/constants/demo-accounts';
import { useAuthStore } from '@/store/auth';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';

function isConnectionError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('unable to connect') ||
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('temporarily unavailable')
  );
}

export default function Login() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const login = useAuthStore((s) => s.login);
  const demoLogin = useAuthStore((s) => s.demoLogin);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoLoadingRole, setDemoLoadingRole] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    setError('');
    if (!email.trim() || !password.trim()) {
      setError('Please enter email and password');
      return;
    }
    setLoading(true);
    try {
      const result = await login(email.trim(), password);
      if (result.success) {
        console.log('[Login] Success, auth guard will redirect');
      } else {
        setError(result.error ?? 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async (account: DemoAccount) => {
    setEmail(account.email);
    setPassword(account.password);
    setError('');
    setDemoLoadingRole(account.role);
    try {
      const result = await demoLogin(account);
      if (result.success) {
        console.log('[Login] Demo success, auth guard will redirect', { role: account.role });
      } else {
        setError(result.error ?? 'Demo login failed');
      }
    } finally {
      setDemoLoadingRole(null);
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

        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <ArrowLeft size={20} color={C.textSecondary} />
        </TouchableOpacity>

        <View style={styles.header}>
          <View style={styles.logoRow}>
            <View style={styles.logoDot} />
            <Text style={styles.logoText}>Dock2Door</Text>
          </View>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>
        </View>

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
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            secureTextEntry
            testID="input-password"
          />

          {error ? (
            isConnectionError(error) ? (
              <View style={styles.connectionErrorBox}>
                <WifiOff size={18} color={C.yellow} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.connectionErrorTitle}>Server Unreachable</Text>
                  <Text style={styles.connectionErrorBody}>{error}</Text>
                </View>
              </View>
            ) : (
              <Text style={styles.error}>{error}</Text>
            )
          ) : null}

          <Button
            label="Sign In"
            onPress={handleLogin}
            loading={loading}
            fullWidth
            size="lg"
          />

          <TouchableOpacity
            onPress={() => router.push('/auth/forgot-password' as any)}
            style={styles.forgotRow}
            testID="forgot-link"
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/auth/signup' as any)} style={styles.switchRow}>
            <Text style={styles.switchText}>{'Don\'t have an account? '}</Text>
            <Text style={styles.switchLink}>Create one</Text>
          </TouchableOpacity>
        </View>

        {/* Demo shortcuts */}
        <View style={styles.demoSection}>
          <Text style={styles.demoLabel}>QUICK DEMO LOGIN</Text>
          <View style={styles.demoGrid}>
            {DEMO_ACCOUNTS.map((account) => {
              const isLoadingDemo = demoLoadingRole === account.role;
              return (
                <TouchableOpacity
                  key={account.role}
                  onPress={() => void handleDemoLogin(account)}
                  disabled={Boolean(demoLoadingRole) || loading}
                  style={[styles.demoChip, isLoadingDemo && styles.demoChipActive]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.demoChipText, isLoadingDemo && styles.demoChipTextActive]}>
                    {isLoadingDemo ? 'Signing in…' : account.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },
  back: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
  header: { marginBottom: 36 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 24 },
  logoDot: { width: 8, height: 8, borderRadius: 2, backgroundColor: C.accent },
  logoText: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  title: { fontSize: 32, fontWeight: '800' as const, color: C.text, letterSpacing: -0.8, marginBottom: 8 },
  subtitle: { fontSize: 16, color: C.textSecondary },
  form: { gap: 16, marginBottom: 40 },
  error: { fontSize: 13, color: C.red, textAlign: 'center' },
  connectionErrorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#2A1F00', borderRadius: 10,
    borderWidth: 1, borderColor: '#5C4A00',
    padding: 12,
  },
  connectionErrorTitle: { fontSize: 13, fontWeight: '700' as const, color: C.yellow, marginBottom: 3 },
  connectionErrorBody: { fontSize: 12, color: '#C8A830', lineHeight: 17 },
  forgotRow: { alignItems: 'center', marginTop: -4 },
  forgotText: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  switchRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 4 },
  switchText: { fontSize: 14, color: C.textSecondary },
  switchLink: { fontSize: 14, color: C.accent, fontWeight: '600' as const },
  demoSection: { gap: 12 },
  demoLabel: { fontSize: 11, color: C.textMuted, fontWeight: '700' as const, letterSpacing: 1.5 },
  demoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  demoChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: C.card, borderRadius: 8,
    borderWidth: 1, borderColor: C.border,
  },
  demoChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  demoChipText: { fontSize: 13, color: C.textSecondary, fontWeight: '500' as const },
  demoChipTextActive: { color: C.accent, fontWeight: '700' as const },
});
