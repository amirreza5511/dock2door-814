import React, { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleProp, StyleSheet, Text, TextInput, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronDown, Search, X } from 'lucide-react-native';
import C from '@/constants/colors';

export interface PickerOption {
  id: string;
  label: string;
  sub?: string;
}

interface PickerFieldProps {
  label?: string;
  value: string;
  options: PickerOption[];
  onSelect: (id: string) => void;
  placeholder?: string;
  emptyText?: string;
  searchPlaceholder?: string;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A searchable single-select field. Shows a friendly label for the selected
 * option while passing the underlying id to onSelect — so users pick SKUs and
 * bin locations from a list instead of typing raw internal ids.
 */
export default function PickerField({
  label,
  value,
  options,
  onSelect,
  placeholder = 'Select…',
  emptyText = 'Nothing to choose yet.',
  searchPlaceholder = 'Search…',
  containerStyle,
  testID,
}: PickerFieldProps) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');

  const selected = useMemo<PickerOption | undefined>(
    () => options.find((o) => o.id === value),
    [options, value],
  );

  const filtered = useMemo<PickerOption[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        testID={testID}
        activeOpacity={0.7}
        onPress={() => { setQuery(''); setOpen(true); }}
        style={styles.field}
      >
        <View style={{ flex: 1 }}>
          {selected ? (
            <>
              <Text style={styles.valueText} numberOfLines={1}>{selected.label}</Text>
              {selected.sub ? <Text style={styles.subText} numberOfLines={1}>{selected.sub}</Text> : null}
            </>
          ) : (
            <Text style={styles.placeholder}>{placeholder}</Text>
          )}
        </View>
        <ChevronDown size={16} color={C.textMuted} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{label ?? 'Select'}</Text>
            <TouchableOpacity onPress={() => setOpen(false)} style={styles.closeBtn}>
              <X size={18} color={C.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.searchBox}>
            <Search size={15} color={C.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor={C.textMuted}
              style={styles.searchInput}
              autoFocus
            />
            {query ? <TouchableOpacity onPress={() => setQuery('')}><X size={14} color={C.textMuted} /></TouchableOpacity> : null}
          </View>
          <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
            {filtered.length === 0 ? (
              <Text style={styles.empty}>{options.length === 0 ? emptyText : 'No matches.'}</Text>
            ) : filtered.map((o) => {
              const active = o.id === value;
              return (
                <TouchableOpacity
                  key={o.id}
                  onPress={() => { onSelect(o.id); setOpen(false); }}
                  style={[styles.row, active && styles.rowActive]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowLabel, active && { color: C.accent }]} numberOfLines={1}>{o.label}</Text>
                    {o.sub ? <Text style={styles.rowSub} numberOfLines={1}>{o.sub}</Text> : null}
                  </View>
                  {active ? <Check size={16} color={C.accent} /> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary, letterSpacing: 0.3 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 14, minHeight: 48,
  },
  valueText: { color: C.text, fontSize: 15, fontWeight: '600' as const },
  subText: { color: C.textMuted, fontSize: 11, marginTop: 1 },
  placeholder: { color: C.textMuted, fontSize: 15 },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  closeBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 16, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, minHeight: 44 },
  searchInput: { flex: 1, color: C.text, fontSize: 14, padding: 0 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  empty: { color: C.textMuted, fontSize: 13, textAlign: 'center' as const, marginTop: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 12 },
  rowActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  rowLabel: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  rowSub: { fontSize: 11, color: C.textMuted, marginTop: 2 },
});
