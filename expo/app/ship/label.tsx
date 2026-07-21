import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator, Linking } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Copy, Printer, PackageSearch, CheckCircle2, MapPin, Navigation } from 'lucide-react-native';
import C from '@/constants/colors';
import Button from '@/components/ui/Button';
import TrackingCode from '@/components/TrackingCode';
import { trackingUrl } from '@/constants/couriers';
import { trpc } from '@/lib/trpc';

interface Parcel {
  id: string;
  tracking_number: string;
  status: string;
  service: string;
  currency: string;
  price: number;
  to_name: string;
  to_line1: string;
  to_city: string;
  to_postal: string;
  from_city: string;
  weight: number;
  weight_unit: string;
  notes: string;
  is_placeholder: boolean;
  label_url: string;
  carrier_code: string;
}

export default function ShipLabel() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = params.id ?? '';

  const query = trpc.parcel.get.useQuery({ id }, { enabled: Boolean(id) });
  const parcel = query.data as Parcel | null;

  const copyTracking = async () => {
    if (!parcel) return;
    await Clipboard.setStringAsync(parcel.tracking_number);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const openLabelPdf = async () => {
    if (!parcel?.label_url) return;
    try {
      await Linking.openURL(parcel.label_url);
    } catch {
      // linking unavailable
    }
  };

  const openTracking = async () => {
    if (!parcel?.tracking_number) return;
    const url = trackingUrl(parcel.tracking_number);
    try {
      await Linking.openURL(url);
    } catch {
      // linking unavailable
    }
  };

  const printLabel = async () => {
    if (!parcel) return;
    const html = `
      <html><body style="font-family:-apple-system,Helvetica,Arial;padding:24px;">
        <h2 style="margin:0 0 4px;">Shipping Label</h2>
        <p style="color:#555;margin:0 0 16px;">${parcel.notes || parcel.service}</p>
        <div style="border:2px solid #000;border-radius:8px;padding:16px;max-width:420px;">
          <p style="margin:0 0 4px;font-size:12px;color:#666;">TO</p>
          <p style="margin:0;font-weight:700;font-size:18px;">${parcel.to_name}</p>
          <p style="margin:0;">${parcel.to_line1}</p>
          <p style="margin:0 0 16px;">${parcel.to_city} ${parcel.to_postal}</p>
          <p style="margin:0 0 4px;font-size:12px;color:#666;">TRACKING</p>
          <p style="margin:0;font-size:22px;font-weight:800;letter-spacing:3px;">${parcel.tracking_number}</p>
        </div>
        <p style="color:#999;font-size:11px;margin-top:16px;">Weight ${parcel.weight}${parcel.weight_unit} · ${parcel.currency} ${Number(parcel.price).toFixed(2)}</p>
      </body></html>`;
    try {
      await Print.printAsync({ html });
    } catch {
      // user cancelled or printing unavailable
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.replace('/ship' as never)} style={styles.backBtn} hitSlop={8}>
          <ChevronLeft size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Your label</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {query.isLoading ? (
          <View style={styles.center}><ActivityIndicator color={C.accent} /></View>
        ) : !parcel ? (
          <View style={styles.center}><Text style={styles.muted}>Label not found.</Text></View>
        ) : (
          <>
            <View style={styles.successRow}>
              <CheckCircle2 size={18} color={C.green} />
              <Text style={styles.successText}>Label created — ready to ship</Text>
            </View>

            <View style={styles.labelCard}>
              <TrackingCode tracking={parcel.tracking_number} qrSize={140} />
              <TouchableOpacity style={styles.copyRow} onPress={copyTracking} activeOpacity={0.8}>
                <Copy size={14} color={C.textSecondary} />
                <Text style={styles.copyText}>Copy tracking number</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.infoCard}>
              <Row label="To" value={`${parcel.to_name}${parcel.to_line1 ? `, ${parcel.to_line1}` : ''}`} />
              <Row label="City" value={`${parcel.to_city}${parcel.to_postal ? ` ${parcel.to_postal}` : ''}`} />
              <Row label="Service" value={parcel.service} />
              <Row label="Weight" value={`${parcel.weight} ${parcel.weight_unit}`} />
              <Row label="Price" value={`${parcel.currency} ${Number(parcel.price).toFixed(2)}`} />
              {parcel.notes ? <Row label="Details" value={parcel.notes} /> : null}
              <Row label="Status" value={parcel.status} last />
            </View>

            {parcel.is_placeholder ? (
              <View style={styles.noteRow}>
                <MapPin size={14} color={C.textMuted} />
                <Text style={styles.note}>
                  This is a preview label. Connect the courier account to buy the real label and drop off or book a pickup.
                </Text>
              </View>
            ) : null}

            <View style={{ gap: 10, marginTop: 20 }}>
              {parcel.label_url ? (
                <Button label="Open label PDF" onPress={openLabelPdf} fullWidth icon={<Printer size={16} color={C.white} />} />
              ) : (
                <Button label="Print / save label" onPress={printLabel} fullWidth icon={<Printer size={16} color={C.white} />} />
              )}
              <Button label="Track parcel" onPress={openTracking} variant="secondary" fullWidth icon={<Navigation size={16} color={C.text} />} />
              <Button label="View all my shipments" onPress={() => router.replace('/ship/mine' as never)} variant="secondary" fullWidth icon={<PackageSearch size={16} color={C.text} />} />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  center: { paddingVertical: 60, alignItems: 'center' },
  muted: { color: C.textSecondary, fontSize: 14 },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  successText: { fontSize: 14, fontWeight: '700' as const, color: C.green },
  labelCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, paddingVertical: 24, alignItems: 'center', gap: 4 },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  copyText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  infoCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingHorizontal: 16, marginTop: 16 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 13 },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  infoLabel: { fontSize: 13, color: C.textMuted, fontWeight: '600' as const },
  infoValue: { flex: 1, fontSize: 13, color: C.text, fontWeight: '600' as const, textAlign: 'right' },
  noteRow: { flexDirection: 'row', gap: 8, marginTop: 14, alignItems: 'flex-start' },
  note: { flex: 1, fontSize: 12, color: C.textMuted, lineHeight: 17 },
});
