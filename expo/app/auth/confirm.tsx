import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  Platform, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { CheckCircle2, XCircle } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { getRoleRoute } from '@/lib/access';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';

type Phase = 'verifying' | 'success' | 'error';

/**
 * Handles the email-confirmation link Supabase sends after sign-up.
 * Supabase redirects here with either:
 *   - a token hash + type in the query string (PKCE/verifyOtp flow), or
 *   - access/refresh tokens in the URL hash fragment (implicit flow).
 * We establish the session, then route the user into their dashboard.
 */
export default function ConfirmEmail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bootstrap = useAuthStore((s) => s.bootstrap);

  const [phase, setPhase] = useState<Phase>('verifying');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    let mounted = true;

    const finish = async () => {
      // Pull the freshly-established profile so we can route by role.
      try {
        const { data } = await supabase.auth.getSession();
        const session = data.session;
        if (!session?.user) {
          if (!mounted) return;
          setPhase('success');
          setMessage('Your email is confirmed. Please sign in to continue.');
          return;
        }
        await bootstrap();
        if (!mounted) return;
        const role = useAuthStore.getState().user?.role;
        setPhase('success');
        setMessage('Your email is confirmed. Welcome aboard!');
        setTimeout(() => {
          if (!mounted) return;
          if (role) {
            router.replace(getRoleRoute(role) as never);
          } else {
            router.replace('/auth/login' as never);
          }
        }, 900);
      } catch {
        if (!mounted) return;
        setPhase('success');
        setMessage('Your email is confirmed. Please sign in to continue.');
      }
    };

    const verify = async () => {
      try {
        if (Platform.OS !== 'web' || typeof window === 'undefined') {
          // Native deep-link handling: the supabase client detects the session
          // from the link automatically; just check for an active session.
          await finish();
          return;
        }

        const url = new URL(window.location.href);
        const search = url.searchParams;
        const hash = new URLSearchParams(url.hash.replace(/^#/, ''));

        // Surface explicit auth errors (expired/used link, etc.)
        const errorDescription =
          search.get('error_description') ?? hash.get('error_description');
        const errorCode = search.get('error') ?? hash.get('error');
        if (errorDescription || errorCode) {
          if (!mounted) return;
          setPhase('error');
          setMessage(
            (errorDescription ?? errorCode ?? 'This confirmation link is invalid.')
              .replace(/\+/g, ' '),
          );
          return;
        }

        // Flow A — token hash + type (verifyOtp)
        const tokenHash = search.get('token_hash') ?? search.get('token');
        const type = search.get('type');
        if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as 'signup' | 'email' | 'recovery' | 'invite' | 'magiclink',
          });
          if (error) {
            if (!mounted) return;
            setPhase('error');
            setMessage(error.message);
            return;
          }
          await finish();
          return;
        }

        // Flow B — access + refresh tokens in the hash fragment
        const accessToken = hash.get('access_token');
        const refreshToken = hash.get('refresh_token');
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            if (!mounted) return;
            setPhase('error');
            setMessage(error.message);
            return;
          }
          await finish();
          return;
        }

        // No token at all — maybe the user already confirmed, or opened the page directly.
        await finish();
      } catch (e) {
        if (!mounted) return;
        setPhase('error');
        setMessage(e instanceof Error ? e.message : 'Could not confirm your email.');
      }
    };

    void verify();
    return () => { mounted = false; };
  }, [bootstrap, router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <LinearGradient colors={['#0D1E35', C.bg]} style={styles.heroBg} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoRow}>
          <View style={styles.logoDot} />
          <Text style={styles.logoText}>Dock2Door</Text>
        </View>

        <View style={styles.card}>
          {phase === 'verifying' && (
            <>
              <ActivityIndicator size="large" color={C.accent} />
              <Text style={styles.title}>Confirming your email…</Text>
              <Text style={styles.subtitle}>This only takes a moment.</Text>
            </>
          )}

          {phase === 'success' && (
            <>
              <View style={[styles.iconWrap, { backgroundColor: C.accentDim }]}>
                <CheckCircle2 size={40} color={C.accent} />
              </View>
              <Text style={styles.title}>Email confirmed</Text>
              <Text style={styles.subtitle}>{message}</Text>
              <Button
                label="Continue"
                onPress={() => router.replace('/auth/login' as never)}
                fullWidth
                size="lg"
              />
            </>
          )}

          {phase === 'error' && (
            <>
              <View style={[styles.iconWrap, { backgroundColor: 'rgba(239,68,68,0.12)' }]}>
                <XCircle size={40} color={C.red} />
              </View>
              <Text style={styles.title}>Confirmation failed</Text>
              <Text style={styles.subtitle}>{message}</Text>
              <Button
                label="Back to sign in"
                onPress={() => router.replace('/auth/login' as never)}
                fullWidth
                size="lg"
                variant="secondary"
              />
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 320 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, justifyContent: 'center' },
  logoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 28 },
  logoDot: { width: 8, height: 8, borderRadius: 2, backgroundColor: C.accent },
  logoText: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  card: {
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    padding: 28,
    alignItems: 'center',
    gap: 14,
  },
  iconWrap: {
    width: 76, height: 76, borderRadius: 38,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text, textAlign: 'center', letterSpacing: -0.4 },
  subtitle: { fontSize: 15, color: C.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 6 },
});
