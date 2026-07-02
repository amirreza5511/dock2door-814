import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QrCode, Warehouse, Info } from 'lucide-react-native';
import C from '@/constants/colors';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';

function normalizeRef(raw: string): string {
  const v = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!v) return '';
  return v.startsWith('WB-') ? v : `WB-${v}`;
}

function qrUrl(data: string, size = 260): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&data=${encodeURIComponent(data)}`;
}

export default function DriverDropoffScreen() {
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState<string>('');
  const [ref, setRef] = useState<string>('');

  const show = () => {
    const n = normalizeRef(input);
    setRef(n);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Warehouse size={22} color={C.accent} /></View>
          <Text style={styles.title}>Warehouse drop-off</Text>
          <Text style={styles.subtitle}>Delivering to a warehouse? Enter the booking reference the customer gave you and show the code to the receiving team.</Text>
        </View>

        <View style={styles.card}>
          <Input label="Booking reference #" value={input} onChangeText={setInput} placeholder="WB-XXXXXXXX" autoCapitalize="characters" />
          <Button label="Show gate code" onPress={show} fullWidth icon={<QrCode size={16} color={C.white} />} disabled={!input.trim()} />
        </View>

        {ref ? (
          <View style={styles.qrCard}>
            <Text style={styles.qrLabel}>Show this to receiving</Text>
            <Image source={{ uri: qrUrl(ref) }} style={styles.qr} contentFit="contain" transition={150} />
            <Text style={styles.refText}>{ref}</Text>
            <Text style={styles.qrHint}>Receiving scans this QR (or types the number) to check your cargo in.</Text>
          </View>
        ) : null}

        <View style={styles.infoBox}>
          <Info size={15} color={C.textSecondary} />
          <Text style={styles.infoText}>Don&apos;t have a reference? Ask the customer to open their booking → Bill of Lading and share the WB- number with you.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, gap: 14 },
  hero: { alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  heroIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 13, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 19 },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 },
  qrCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.accent + '40', padding: 20, alignItems: 'center', gap: 10 },
  qrLabel: { fontSize: 11, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6, fontWeight: '700' as const },
  qr: { width: 220, height: 220, borderRadius: 12, backgroundColor: C.white },
  refText: { fontSize: 24, fontWeight: '800' as const, color: C.text, letterSpacing: 1 },
  qrHint: { fontSize: 12, color: C.textMuted, textAlign: 'center' as const, lineHeight: 17 },
  infoBox: { flexDirection: 'row', gap: 8, backgroundColor: C.bgSecondary, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border },
  infoText: { flex: 1, fontSize: 12, color: C.textSecondary, lineHeight: 17 },
});
