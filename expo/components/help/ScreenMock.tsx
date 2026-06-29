import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import C from '@/constants/colors';
import type { ScreenDoc } from '@/constants/help';

/**
 * Renders a small, recognizable stylized preview ("screenshot") of a screen
 * based on its mock kind. Purely presentational — no images are fetched.
 */
function ScreenMock({ doc, accent }: { doc: ScreenDoc; accent: string }) {
  const rows = doc.mockRows ?? [];
  return (
    <View style={styles.device}>
      {/* status bar */}
      <View style={styles.statusBar}>
        <View style={styles.notch} />
      </View>
      {/* app header */}
      <View style={styles.appHeader}>
        <View style={[styles.headerAccent, { backgroundColor: accent }]} />
        <View style={styles.headerTitleBar} />
      </View>

      <View style={styles.body}>
        {renderBody(doc.mock, rows, accent)}
      </View>

      {doc.mockCta && (
        <View style={[styles.cta, { backgroundColor: accent }]}>
          <Text style={styles.ctaText} numberOfLines={1}>{doc.mockCta}</Text>
        </View>
      )}
    </View>
  );
}

function renderBody(kind: ScreenDoc['mock'], rows: string[], accent: string): React.ReactNode {
  switch (kind) {
    case 'dashboard':
      return (
        <View style={styles.statRow}>
          {rows.slice(0, 3).map((r, i) => (
            <View key={i} style={styles.statTile}>
              <View style={[styles.statBar, { backgroundColor: accent, width: 18 + (i * 8) }]} />
              <Text style={styles.tileLabel} numberOfLines={2}>{r}</Text>
            </View>
          ))}
        </View>
      );
    case 'grid':
      return (
        <View style={styles.grid}>
          {rows.slice(0, 4).map((r, i) => (
            <View key={i} style={styles.gridTile}>
              <View style={[styles.gridDot, { backgroundColor: accent }]} />
              <Text style={styles.tileLabel} numberOfLines={1}>{r}</Text>
            </View>
          ))}
        </View>
      );
    case 'map':
      return (
        <View style={styles.map}>
          <View style={styles.mapGridLines} />
          <View style={[styles.pin, { left: '18%', top: '24%', backgroundColor: C.green }]} />
          <View style={[styles.route]} />
          <View style={[styles.pin, { right: '16%', bottom: '20%', backgroundColor: C.red }]} />
          <View style={[styles.truck, { backgroundColor: accent }]} />
          <View style={styles.mapLabels}>
            {rows.slice(0, 2).map((r, i) => (
              <View key={i} style={styles.mapChip}>
                <Text style={styles.mapChipText} numberOfLines={1}>{r}</Text>
              </View>
            ))}
          </View>
        </View>
      );
    case 'chat':
      return (
        <View style={styles.chat}>
          <View style={[styles.bubbleIn]}>
            <Text style={styles.bubbleText} numberOfLines={1}>{rows[0] ?? 'Hi there'}</Text>
          </View>
          <View style={[styles.bubbleOut, { backgroundColor: accent }]}>
            <Text style={[styles.bubbleText, { color: C.white }]} numberOfLines={1}>{rows[1] ?? 'On my way'}</Text>
          </View>
          <View style={[styles.bubbleIn]}>
            <Text style={styles.bubbleText} numberOfLines={1}>{rows[2] ?? 'Thanks!'}</Text>
          </View>
        </View>
      );
    case 'form':
    case 'wizard':
      return (
        <View style={styles.form}>
          {rows.slice(0, 4).map((r, i) => (
            <View key={i} style={styles.field}>
              <Text style={styles.fieldLabel} numberOfLines={1}>{r}</Text>
              <View style={styles.fieldInput} />
            </View>
          ))}
        </View>
      );
    case 'detail':
    case 'list':
    default:
      return (
        <View style={styles.list}>
          {rows.slice(0, 3).map((r, i) => (
            <View key={i} style={styles.listRow}>
              <View style={[styles.listIcon, { backgroundColor: accent }]} />
              <Text style={styles.listText} numberOfLines={1}>{r}</Text>
            </View>
          ))}
        </View>
      );
  }
}

export default React.memo(ScreenMock);

const styles = StyleSheet.create({
  device: {
    backgroundColor: C.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderLight,
    padding: 10,
    gap: 8,
    overflow: 'hidden',
  },
  statusBar: { alignItems: 'center', height: 12, justifyContent: 'center' },
  notch: { width: 50, height: 5, borderRadius: 3, backgroundColor: C.border },
  appHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerAccent: { width: 22, height: 22, borderRadius: 7 },
  headerTitleBar: { flex: 1, height: 10, borderRadius: 5, backgroundColor: C.cardElevated, maxWidth: 120 },
  body: { minHeight: 96 },

  statRow: { flexDirection: 'row', gap: 8 },
  statTile: { flex: 1, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 10, gap: 8, minHeight: 70 },
  statBar: { height: 8, borderRadius: 4 },
  tileLabel: { fontSize: 9, color: C.textSecondary, lineHeight: 12 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridTile: { width: '47%', backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 10, gap: 6, minHeight: 44 },
  gridDot: { width: 16, height: 16, borderRadius: 5 },

  map: { height: 110, backgroundColor: '#0A1726', borderRadius: 10, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  mapGridLines: { ...StyleSheet.absoluteFillObject, borderColor: C.border, borderTopWidth: 1, borderBottomWidth: 1, opacity: 0.4, marginVertical: 36 },
  pin: { position: 'absolute', width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: C.white },
  route: { position: 'absolute', left: '22%', top: '30%', width: '56%', height: 2, backgroundColor: C.borderLight, transform: [{ rotate: '24deg' }] },
  truck: { position: 'absolute', left: '46%', top: '44%', width: 14, height: 10, borderRadius: 3, borderWidth: 1.5, borderColor: C.white },
  mapLabels: { position: 'absolute', left: 8, bottom: 8, gap: 4 },
  mapChip: { backgroundColor: C.overlay, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  mapChipText: { fontSize: 8, color: C.text },

  chat: { gap: 6, paddingVertical: 4 },
  bubbleIn: { alignSelf: 'flex-start', maxWidth: '78%', backgroundColor: C.card, borderRadius: 10, borderBottomLeftRadius: 3, borderWidth: 1, borderColor: C.border, paddingHorizontal: 9, paddingVertical: 6 },
  bubbleOut: { alignSelf: 'flex-end', maxWidth: '78%', borderRadius: 10, borderBottomRightRadius: 3, paddingHorizontal: 9, paddingVertical: 6 },
  bubbleText: { fontSize: 9, color: C.text },

  form: { gap: 8 },
  field: { gap: 4 },
  fieldLabel: { fontSize: 9, color: C.textSecondary },
  fieldInput: { height: 12, borderRadius: 5, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },

  list: { gap: 6 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 9, paddingVertical: 8 },
  listIcon: { width: 14, height: 14, borderRadius: 4 },
  listText: { fontSize: 9, color: C.text, flex: 1 },

  cta: { borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingVertical: 9 },
  ctaText: { fontSize: 10, fontWeight: '700' as const, color: C.white },
});
