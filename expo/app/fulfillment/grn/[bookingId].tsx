import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import { Image } from 'expo-image';
import * as Print from 'expo-print';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Printer, Package, ClipboardCheck, CheckCircle2, AlertTriangle, XCircle, Building2, Boxes, ArrowRight } from 'lucide-react-native';
import C from '@/constants/colors';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import { trpc } from '@/lib/trpc';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import { useAuthStore } from '@/store/auth';

type InspectionStatus = 'good' | 'damaged' | 'partial' | 'rejected';

interface GrnRow {
  id: string;
  grn_number: string;
  booking_id: string | null;
  inspection_status: InspectionStatus;
  pallets_received: number;
  pieces_received: number | null;
  condition_notes: string;
  inspector_notes: string;
  issued_at: string;
}

const STATUS_OPTS: { key: InspectionStatus; label: string; color: string; icon: React.ComponentType<{ size?: number; color?: string }> }[] = [
  { key: 'good', label: 'Good', color: C.green, icon: CheckCircle2 },
  { key: 'damaged', label: 'Damaged', color: C.yellow, icon: AlertTriangle },
  { key: 'partial', label: 'Partial', color: C.blue, icon: Package },
  { key: 'rejected', label: 'Rejected', color: C.red, icon: XCircle },
];

const STATUS_LABEL: Record<InspectionStatus, string> = {
  good: 'Received in good condition',
  damaged: 'Received with damage',
  partial: 'Partial shipment received',
  rejected: 'Rejected',
};

function qrUrl(data: string, size = 220): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&data=${encodeURIComponent(data)}`;
}

export default function GoodsReceivedNoteScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const user = useAuthStore((s) => s.user);
  const bootstrap = useDockBootstrapData();
  const utils = trpc.useUtils();

  const { warehouseBookings, warehouseListings, companies } = bootstrap.data;
  const booking = useMemo(() => warehouseBookings.find((b) => b.id === bookingId) ?? null, [warehouseBookings, bookingId]);
  const listing = useMemo(() => warehouseListings.find((l) => l.id === booking?.listingId) ?? null, [warehouseListings, booking]);
  const warehouseCo = useMemo(() => companies.find((c) => c.id === listing?.companyId) ?? null, [companies, listing]);
  const customerCo = useMemo(() => companies.find((c) => c.id === booking?.customerCompanyId) ?? null, [companies, booking]);

  const isWarehouse = !!listing && listing.companyId === user?.companyId;

  const grnQuery = trpc.grn.getByBooking.useQuery(
    { bookingId: bookingId ?? '' },
    { enabled: !!bookingId },
  );
  const grn = (grnQuery.data as GrnRow | null) ?? null;

  const [status, setStatus] = useState<InspectionStatus>('good');
  const [pallets, setPallets] = useState<string>('');
  const [pieces, setPieces] = useState<string>('');
  const [condition, setCondition] = useState<string>('');
  const [note, setNote] = useState<string>('');

  const issue = trpc.grn.issue.useMutation({
    onSuccess: async () => {
      await utils.grn.getByBooking.invalidate({ bookingId: bookingId ?? '' });
      await utils.dock.bootstrap.invalidate();
    },
  });

  if (bootstrap.isLoading || grnQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading document" /></View>;
  }
  if (!booking) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg, paddingTop: insets.top + 40 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenFeedback state="error" title="Booking not found" message="This booking is no longer available." />
        <View style={{ padding: 16 }}><Button label="Back" variant="secondary" onPress={() => router.back()} /></View>
      </View>
    );
  }

  const ref = booking.referenceNumber || `WB-${booking.id.slice(0, 8).toUpperCase()}`;
  const grnNo = grn?.grn_number ?? 'Pending';
  const effStatus: InspectionStatus = grn?.inspection_status ?? status;
  const statusMeta = STATUS_OPTS.find((s) => s.key === effStatus) ?? STATUS_OPTS[0];

  const doIssue = async () => {
    try {
      await issue.mutateAsync({
        bookingId: booking.id,
        inspectionStatus: status,
        palletsReceived: pallets.trim() ? Number(pallets) : booking.palletsRequested,
        piecesReceived: pieces.trim() ? Number(pieces) : null,
        conditionNotes: condition.trim(),
        inspectorNotes: note.trim(),
      });
      Alert.alert('GRN issued ✅', 'The goods received note is recorded and ready to print.');
    } catch (err) {
      Alert.alert('Could not issue GRN', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const printHtml = (): string => {
    const row = (label: string, value: string) => `<tr><td class="l">${label}</td><td class="v">${value || '—'}</td></tr>`;
    const palletsRx = grn ? String(grn.pallets_received) : String(booking.palletsRequested);
    const piecesRx = grn?.pieces_received != null ? String(grn.pieces_received) : (pieces || '—');
    return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      * { font-family: -apple-system, Helvetica, Arial, sans-serif; }
      body { padding: 28px; color: #111; }
      .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #111; padding-bottom: 12px; }
      .brand { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
      .doc { text-align: right; }
      .doc h1 { font-size: 16px; margin: 0; text-transform: uppercase; letter-spacing: 1px; }
      .ref { font-size: 24px; font-weight: 800; margin-top: 4px; }
      .grid { display: flex; gap: 16px; margin-top: 20px; }
      .box { flex: 1; border: 1px solid #ccc; border-radius: 8px; padding: 12px; }
      .box h3 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #666; }
      .box p { margin: 2px 0; font-size: 13px; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      td { padding: 9px 10px; border-bottom: 1px solid #eee; font-size: 13px; }
      td.l { color: #666; width: 42%; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
      td.v { font-weight: 600; }
      .cond { margin-top: 16px; padding: 10px 12px; border-radius: 8px; border: 1px solid #ccc; font-size: 13px; }
      .qr { text-align: center; margin-top: 24px; }
      .qr img { width: 140px; height: 140px; }
      .sign { display: flex; gap: 16px; margin-top: 40px; }
      .sign div { flex: 1; border-top: 1px solid #111; padding-top: 6px; font-size: 11px; color: #666; }
      .foot { margin-top: 30px; font-size: 10px; color: #999; text-align: center; }
    </style></head><body>
      <div class="top">
        <div><div class="brand">Dock2Door</div><div style="font-size:11px;color:#666">Goods Received Note</div></div>
        <div class="doc"><h1>Goods Received Note</h1><div class="ref">${grnNo}</div>
        <div style="font-size:11px;color:#666">${new Date(grn?.issued_at ?? Date.now()).toLocaleString()}</div></div>
      </div>
      <div class="grid">
        <div class="box"><h3>Received from (Customer)</h3>
          <p><b>${customerCo?.name ?? '—'}</b></p>
          <p>${customerCo?.address ?? ''} ${customerCo?.city ?? ''}</p>
        </div>
        <div class="box"><h3>Received by (Warehouse)</h3>
          <p><b>${warehouseCo?.name ?? listing?.name ?? '—'}</b></p>
          <p>${listing?.address ?? ''} ${listing?.city ?? ''}</p>
        </div>
      </div>
      <table>
        ${row('Booking reference', ref)}
        ${row('Inspection result', STATUS_LABEL[effStatus])}
        ${row('Pallets received', palletsRx)}
        ${row('Pallets booked', String(booking.palletsRequested))}
        ${row('Pieces received', piecesRx)}
        ${row('Cargo', booking.cargoDescription || '—')}
      </table>
      <div class="cond"><b>Condition notes:</b> ${(grn?.condition_notes ?? condition) || '—'}</div>
      <div class="cond"><b>Inspector notes:</b> ${(grn?.inspector_notes ?? note) || '—'}</div>
      <div class="qr">
        <img src="${qrUrl(grnNo, 300)}" />
      </div>
      <div class="sign">
        <div>Inspected by (warehouse)</div>
        <div>Customer acknowledgement</div>
      </div>
      <div class="foot">Generated by Dock2Door · Permanent proof of acceptance for cargo ${ref}.</div>
    </body></html>`;
  };

  const doPrint = async () => {
    try {
      if (Platform.OS === 'web') {
        await Print.printAsync({ html: printHtml() });
      } else {
        const { uri } = await Print.printToFileAsync({ html: printHtml() });
        await Print.printAsync({ uri });
      }
    } catch (err) {
      if (err instanceof Error && /cancel/i.test(err.message)) return;
      Alert.alert('Print failed', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const StatusIcon = statusMeta.icon;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back">
          <ArrowLeft size={18} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Goods Received Note</Text>
          <Text style={styles.subtitle}>{grnNo}</Text>
        </View>
        <View style={[styles.iconBubble, { backgroundColor: C.green + '20' }]}>
          <ClipboardCheck size={20} color={C.green} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 90 }]}>
        {/* GRN document card */}
        <View style={styles.docCard}>
          <View style={styles.docTop}>
            <View>
              <Text style={styles.brand}>Dock2Door</Text>
              <Text style={styles.docKind}>Goods Received Note</Text>
            </View>
            {grn ? (
              <View style={[styles.issuedTag, { backgroundColor: statusMeta.color + '18' }]}>
                <StatusIcon size={12} color={statusMeta.color} />
                <Text style={[styles.issuedText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
              </View>
            ) : (
              <View style={styles.draftTag}><Text style={styles.draftText}>Not issued</Text></View>
            )}
          </View>

          <View style={styles.refBlock}>
            <View style={{ flex: 1 }}>
              <Text style={styles.refLabel}>GRN #</Text>
              <Text style={styles.refValue}>{grnNo}</Text>
              <Text style={styles.refSub}>for {ref}</Text>
            </View>
            {grn ? <Image source={{ uri: qrUrl(grnNo) }} style={styles.qr} contentFit="contain" transition={150} /> : null}
          </View>

          <View style={styles.partyRow}>
            <View style={styles.party}>
              <Text style={styles.partyLabel}>Received from</Text>
              <Text style={styles.partyName}>{customerCo?.name ?? '—'}</Text>
            </View>
            <View style={styles.party}>
              <Text style={styles.partyLabel}>Received by</Text>
              <View style={styles.partyNameRow}>
                <Building2 size={12} color={C.textSecondary} />
                <Text style={styles.partyName}>{warehouseCo?.name ?? listing?.name ?? '—'}</Text>
              </View>
            </View>
          </View>

          <View style={styles.cargoRow}>
            <Package size={13} color={C.textSecondary} />
            <Text style={styles.cargoText}>
              {grn ? `${grn.pallets_received}` : booking.palletsRequested} pallets received
              {grn?.pieces_received != null ? ` · ${grn.pieces_received} pieces` : ''}
            </Text>
          </View>

          {grn ? (
            <>
              {grn.condition_notes ? <Text style={styles.grnNote}>Condition: {grn.condition_notes}</Text> : null}
              {grn.inspector_notes ? <Text style={styles.grnNote}>Notes: {grn.inspector_notes}</Text> : null}
              <Text style={styles.issuedAt}>Issued {new Date(grn.issued_at).toLocaleString()}</Text>
            </>
          ) : null}
        </View>

        {/* Inspection form (warehouse only, before issuing) */}
        {isWarehouse && !grn ? (
          <>
            <Text style={styles.sectionTitle}>Inspection</Text>
            <View style={styles.card}>
              <Text style={styles.fieldLabel}>Condition on arrival</Text>
              <View style={styles.statusRow}>
                {STATUS_OPTS.map((s) => {
                  const active = status === s.key;
                  const Icon = s.icon;
                  return (
                    <TouchableOpacity key={s.key} onPress={() => setStatus(s.key)} style={[styles.statusChip, active && { borderColor: s.color, backgroundColor: s.color + '18' }]}>
                      <Icon size={15} color={active ? s.color : C.textSecondary} />
                      <Text style={[styles.statusChipText, active && { color: s.color }]}>{s.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}><Input label="Pallets received" value={pallets} onChangeText={setPallets} keyboardType="numeric" placeholder={String(booking.palletsRequested)} /></View>
                <View style={{ flex: 1 }}><Input label="Pieces (optional)" value={pieces} onChangeText={setPieces} keyboardType="numeric" placeholder="0" /></View>
              </View>
              <Input label="Condition notes" value={condition} onChangeText={setCondition} placeholder="e.g. 1 pallet shrink-wrap torn" multiline numberOfLines={2} />
              <Input label="Inspector notes" value={note} onChangeText={setNote} placeholder="Any remarks for the record" multiline numberOfLines={2} />
              <Button label="Issue Goods Received Note" onPress={() => void doIssue()} loading={issue.isPending} fullWidth icon={<ClipboardCheck size={15} color={C.white} />} />
              <Text style={styles.hint}>Issuing the GRN closes the inbound receipt and creates a permanent acceptance record the customer can see.</Text>
            </View>
          </>
        ) : null}

        {!isWarehouse && !grn ? (
          <View style={styles.card}>
            <Text style={styles.waitText}>The warehouse will issue this Goods Received Note after they inspect and accept your cargo.</Text>
          </View>
        ) : null}

        {grn ? (
          <>
            {effStatus !== 'rejected' ? (
              <View style={styles.nextCard}>
                <View style={styles.nextHead}>
                  <View style={[styles.iconBubble, { width: 30, height: 30, borderRadius: 9, backgroundColor: C.green + '20' }]}>
                    <Boxes size={16} color={C.green} />
                  </View>
                  <Text style={styles.nextTitle}>On hand & ready to ship</Text>
                </View>
                <Text style={styles.nextBody}>
                  {`${grn.pieces_received ?? grn.pallets_received} ${grn.pieces_received != null ? 'pieces' : 'pallets'} were added to this booking's inventory. Create an outbound order to pick, pack and ship them.`}
                </Text>
                <Button
                  label="Go to Fulfillment"
                  onPress={() => router.push(`/fulfillment/${booking.id}` as never)}
                  fullWidth
                  variant="outline"
                  icon={<ArrowRight size={15} color={C.accent} />}
                />
              </View>
            ) : (
              <View style={styles.nextCard}>
                <Text style={styles.nextBody}>This shipment was rejected — nothing was added to inventory. Coordinate the return with the customer.</Text>
              </View>
            )}
            <Button label="Print / Save PDF" onPress={() => void doPrint()} fullWidth size="lg" icon={<Printer size={16} color={C.white} />} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  iconBubble: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 12, color: C.textMuted, marginTop: 2, letterSpacing: 0.5 },
  body: { padding: 16, gap: 12 },
  docCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16, gap: 14 },
  docTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  brand: { fontSize: 20, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  docKind: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  issuedTag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  issuedText: { fontSize: 11, fontWeight: '700' as const },
  draftTag: { backgroundColor: C.bgSecondary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: C.border },
  draftText: { fontSize: 11, color: C.textMuted, fontWeight: '700' as const },
  refBlock: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.bgSecondary, borderRadius: 12, padding: 12 },
  refLabel: { fontSize: 10, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  refValue: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: 0.5, marginTop: 4 },
  refSub: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  qr: { width: 74, height: 74, borderRadius: 8, backgroundColor: C.white },
  partyRow: { flexDirection: 'row', gap: 10 },
  party: { flex: 1, gap: 2 },
  partyLabel: { fontSize: 10, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  partyName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  partyNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cargoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 },
  cargoText: { fontSize: 12, color: C.textSecondary },
  grnNote: { fontSize: 12, color: C.textSecondary },
  issuedAt: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  sectionTitle: { fontSize: 11, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 6 },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 },
  fieldLabel: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.bgSecondary },
  statusChipText: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary },
  twoCol: { flexDirection: 'row', gap: 10 },
  hint: { fontSize: 11, color: C.textMuted, lineHeight: 16 },
  waitText: { fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  nextCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.green + '44', padding: 14, gap: 10 },
  nextHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nextTitle: { fontSize: 14, fontWeight: '800' as const, color: C.text },
  nextBody: { fontSize: 12, color: C.textSecondary, lineHeight: 18 },
});
