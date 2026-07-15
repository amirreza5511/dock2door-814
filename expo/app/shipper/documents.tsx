import React, { useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Print from 'expo-print';
import { ArrowLeft, FileText, Printer, Tag } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import QRCode from '@/components/QRCode';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { CARGO_CLASS_LABEL, CargoClass, VEHICLE_LABEL, VehicleType } from '@/constants/loads';
import { trpc } from '@/lib/trpc';
import { buildBolHtml, buildLabelsHtml, type PieceInfo, type ShipmentInfo } from '@/lib/bol-print';
import { useAuthStore } from '@/store/auth';

type LoadRow = {
  id: string; vehicle_type: string; cargo_type: string; cargo_class?: string | null;
  pallets: number; item_count?: number | null; weight_kg?: number | null;
  pickup_address?: string | null; dropoff_address?: string | null;
  recipient_name?: string | null; recipient_phone?: string | null;
  distance_km?: number | null; total_price?: number | null;
  item_description?: string | null; notes?: string | null;
  bol_number?: string | null; created_at: string;
};

type PieceRow = {
  id: string; piece_no: number; total_pieces: number; barcode: string;
  cargo_class: string; weight_kg: number; scanned: boolean;
};

export default function ShipmentDocuments() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { loadId } = useLocalSearchParams<{ loadId: string }>();

  const loadQuery = trpc.loads.get.useQuery({ id: loadId ?? '' }, { enabled: Boolean(loadId) });
  const piecesQuery = trpc.loads.pieces.useQuery({ loadId: loadId ?? '' }, { enabled: Boolean(loadId) });

  const load = loadQuery.data as LoadRow | undefined;
  const pieces = useMemo<PieceRow[]>(() => (piecesQuery.data ?? []) as PieceRow[], [piecesQuery.data]);

  const shipment = useMemo<ShipmentInfo | null>(() => {
    if (!load) return null;
    return {
      bolNumber: load.bol_number || 'BOL',
      pickupAddress: load.pickup_address ?? '',
      dropoffAddress: load.dropoff_address ?? '',
      senderName: user?.name ?? 'Shipper',
      recipientName: load.recipient_name ?? '',
      recipientPhone: load.recipient_phone ?? '',
      cargoClassLabel: CARGO_CLASS_LABEL[(load.cargo_class ?? 'General') as CargoClass] ?? (load.cargo_class ?? 'General'),
      vehicleLabel: VEHICLE_LABEL[load.vehicle_type as VehicleType] ?? load.vehicle_type,
      pallets: Number(load.pallets ?? 0),
      itemCount: Number(load.item_count ?? 0),
      weightKg: Number(load.weight_kg ?? 0),
      distanceKm: Number(load.distance_km ?? 0),
      totalPrice: Number(load.total_price ?? 0),
      itemDescription: load.item_description ?? '',
      notes: load.notes ?? '',
      createdAt: load.created_at,
    };
  }, [load, user?.name]);

  const pieceInfos = useMemo<PieceInfo[]>(
    () => pieces.map((p) => ({ piece_no: p.piece_no, total_pieces: p.total_pieces, barcode: p.barcode, cargo_class: p.cargo_class, weight_kg: Number(p.weight_kg ?? 0) })),
    [pieces],
  );

  const printLabels = async () => {
    if (!shipment) return;
    try {
      await Print.printAsync({ html: buildLabelsHtml(shipment, pieceInfos) });
    } catch {
      // user cancelled or no printer — silent.
    }
  };
  const printBol = async () => {
    if (!shipment) return;
    try {
      await Print.printAsync({ html: buildBolHtml(shipment, pieceInfos) });
    } catch {
      // silent
    }
  };

  if (loadQuery.isLoading || piecesQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading documents" /></View>;
  }
  if (loadQuery.isError || !shipment) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Shipment not found" onRetry={() => void loadQuery.refetch()} /></View>;
  }

  const scannedCount = pieces.filter((p) => p.scanned).length;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>Shipment documents</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {/* Master BOL summary */}
        <Card elevated style={styles.bolCard}>
          <View style={styles.bolTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bolTag}>BILL OF LADING</Text>
              <Text style={styles.bolNo}>{shipment.bolNumber}</Text>
              <Text style={styles.bolMeta}>{pieces.length} piece{pieces.length === 1 ? '' : 's'} · {shipment.cargoClassLabel}</Text>
            </View>
            <View style={styles.qrWrap}><QRCode value={shipment.bolNumber} size={92} /></View>
          </View>
          <View style={styles.routeCol}>
            <View style={styles.routeRow}><View style={[styles.dot, { backgroundColor: C.green }]} /><Text style={styles.routeText} numberOfLines={2}>{shipment.pickupAddress || 'Pickup'}</Text></View>
            <View style={styles.routeRow}><View style={[styles.dot, { backgroundColor: C.red }]} /><Text style={styles.routeText} numberOfLines={2}>{shipment.dropoffAddress || 'Drop-off'}</Text></View>
          </View>
          {pieces.length > 0 ? (
            <View style={styles.scanBar}>
              <Text style={styles.scanBarText}>{scannedCount} of {pieces.length} scanned at pickup</Text>
              <View style={styles.scanTrack}><View style={[styles.scanFill, { width: `${pieces.length ? (scannedCount / pieces.length) * 100 : 0}%` }]} /></View>
            </View>
          ) : null}
          <View style={styles.printRow}>
            <TouchableOpacity style={[styles.printBtn, styles.printPrimary]} onPress={() => void printBol()}>
              <FileText size={16} color={C.white} />
              <Text style={styles.printPrimaryText}>Print BOL</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.printBtn, styles.printSecondary]} onPress={() => void printLabels()}>
              <Printer size={16} color={C.accent} />
              <Text style={styles.printSecondaryText}>Print all labels</Text>
            </TouchableOpacity>
          </View>
          {Platform.OS === 'web' ? <Text style={styles.webHint}>On web, printing opens your browser print dialog — save as PDF if you don&apos;t have a printer.</Text> : null}
        </Card>

        {/* Per-piece labels */}
        <View style={styles.sectionRow}>
          <Tag size={15} color={C.accent} />
          <Text style={styles.sectionTitle}>Piece labels</Text>
        </View>
        <Text style={styles.sectionHint}>Print and stick one label on each pallet/box. The driver scans these at pickup.</Text>

        {pieceInfos.map((p) => (
          <Card key={p.barcode} style={[styles.labelCard, pieces.find((x) => x.barcode === p.barcode)?.scanned ? styles.labelScanned : null]}>
            <View style={styles.labelLeft}>
              <Text style={styles.labelCount}>{p.piece_no}<Text style={styles.labelOf}> / {p.total_pieces}</Text></Text>
              <Text style={styles.labelClass}>{shipment.cargoClassLabel}</Text>
              <Text style={styles.labelCode}>{p.barcode}</Text>
              {pieces.find((x) => x.barcode === p.barcode)?.scanned ? <Text style={styles.labelScannedTag}>✓ Scanned</Text> : null}
            </View>
            <View style={styles.labelQr}><QRCode value={p.barcode} size={84} /></View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  scroll: { padding: 16, gap: 14 },
  bolCard: { gap: 14, padding: 16 },
  bolTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  bolTag: { fontSize: 11, fontWeight: '800' as const, color: C.accent, letterSpacing: 1 },
  bolNo: { fontSize: 22, fontWeight: '900' as const, color: C.text, letterSpacing: -0.5, marginTop: 2 },
  bolMeta: { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  qrWrap: { padding: 6, backgroundColor: C.white, borderRadius: 10 },
  routeCol: { gap: 8 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  routeText: { flex: 1, fontSize: 13, color: C.textSecondary },
  scanBar: { gap: 6 },
  scanBarText: { fontSize: 12, fontWeight: '700' as const, color: C.text },
  scanTrack: { height: 6, borderRadius: 3, backgroundColor: C.border, overflow: 'hidden' },
  scanFill: { height: 6, borderRadius: 3, backgroundColor: C.green },
  printRow: { flexDirection: 'row', gap: 10 },
  printBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 13 },
  printPrimary: { backgroundColor: C.accent },
  printPrimaryText: { fontSize: 14, fontWeight: '800' as const, color: C.white },
  printSecondary: { backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.accent },
  printSecondaryText: { fontSize: 14, fontWeight: '800' as const, color: C.accent },
  webHint: { fontSize: 11, color: C.textMuted, lineHeight: 15 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  sectionHint: { fontSize: 12, color: C.textMuted, lineHeight: 16, marginTop: -6 },
  labelCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  labelScanned: { borderColor: C.green, borderWidth: 1 },
  labelLeft: { flex: 1, gap: 3 },
  labelCount: { fontSize: 30, fontWeight: '900' as const, color: C.text, lineHeight: 32 },
  labelOf: { fontSize: 16, fontWeight: '600' as const, color: C.textMuted },
  labelClass: { fontSize: 13, fontWeight: '700' as const, color: C.accent },
  labelCode: { fontSize: 12, color: C.textSecondary, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', letterSpacing: 0.5 },
  labelScannedTag: { fontSize: 12, fontWeight: '800' as const, color: C.green, marginTop: 2 },
  labelQr: { padding: 6, backgroundColor: C.white, borderRadius: 10 },
});
