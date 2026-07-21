import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import QRCode from '@/components/QRCode';
import C from '@/constants/colors';

interface Props {
  tracking: string;
  /** QR size in px. */
  qrSize?: number;
}

/**
 * Renders a shipment's scannable codes: a QR (offline-generated) plus a
 * barcode-style strip derived deterministically from the tracking number, with
 * the human-readable tracking string underneath. Used on labels and receipts.
 */
function TrackingCode({ tracking, qrSize = 128 }: Props) {
  const bars = useMemo(() => {
    // Deterministic bar widths from the tracking string (visual barcode strip).
    const out: number[] = [];
    for (let i = 0; i < tracking.length; i++) {
      const code = tracking.charCodeAt(i);
      out.push(1 + (code % 3)); // 1..3 px wide
      out.push(1 + ((code >> 2) % 2)); // gap 1..2
    }
    return out;
  }, [tracking]);

  return (
    <View style={styles.wrap}>
      <View style={styles.qrBox}>
        <QRCode value={tracking} size={qrSize} margin={1} />
      </View>
      <View style={styles.barcode}>
        {bars.map((w, i) => (
          <View
            key={i}
            style={{ width: w, height: 52, backgroundColor: i % 2 === 0 ? C.black : 'transparent' }}
          />
        ))}
      </View>
      <Text style={styles.tracking}>{tracking}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 12 },
  qrBox: { backgroundColor: C.white, padding: 10, borderRadius: 10 },
  barcode: {
    flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: C.white, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6,
    overflow: 'hidden',
  },
  tracking: { fontSize: 15, fontWeight: '800' as const, color: C.text, letterSpacing: 2 },
});

export default React.memo(TrackingCode);
