import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import C from '@/constants/colors';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not Found', headerStyle: { backgroundColor: C.bgSecondary }, headerTintColor: C.text }} />
      <View style={styles.container}>
        <Text style={styles.code}>404</Text>
        <Text style={styles.title}>Page not found</Text>
        <Text style={styles.sub}>This screen does not exist.</Text>
        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Go to home screen</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: C.bg,
  },
  code: {
    fontSize: 72,
    fontWeight: '800' as const,
    color: C.accent,
    letterSpacing: -2,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: C.text,
    marginBottom: 8,
  },
  sub: {
    fontSize: 14,
    color: C.textSecondary,
    marginBottom: 24,
  },
  link: { marginTop: 8 },
  linkText: {
    fontSize: 15,
    color: C.accent,
    fontWeight: '600' as const,
  },
});
