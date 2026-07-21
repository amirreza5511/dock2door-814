import React, { useMemo, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, Pressable,
} from 'react-native';
import { Search, X, Check, ChevronDown } from 'lucide-react-native';
import C from '@/constants/colors';

export interface PickerOption {
  /** The value stored on select (usually a human label so it reads well in lists). */
  value: string;
  /** Primary line shown in the list. */
  label: string;
  /** Optional secondary line (e.g. country / code). */
  sublabel?: string;
  /** Extra searchable text (codes, aliases). */
  keywords?: string;
  /** Optional leading glyph (e.g. flag emoji). */
  glyph?: string;
}

interface WorldPickerProps {
  label: string;
  value: string;
  options: PickerOption[];
  placeholder?: string;
  /** Allow selecting free-typed text not in the list. */
  allowCustom?: boolean;
  onSelect: (value: string) => void;
  testID?: string;
}

/**
 * A searchable, worldwide picker for countries, seaports, airports, etc.
 * Renders as a tappable field that opens a full-height search modal.
 * When `allowCustom` is set, the typed query can be used as-is.
 */
export default function WorldPicker({
  label, value, options, placeholder, allowCustom = true, onSelect, testID,
}: WorldPickerProps) {
  const [open, setOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      o.label.toLowerCase().includes(q) ||
      (o.sublabel?.toLowerCase().includes(q) ?? false) ||
      (o.keywords?.toLowerCase().includes(q) ?? false) ||
      o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  const handleSelect = (v: string) => {
    onSelect(v);
    setOpen(false);
    setQuery('');
  };

  const showCustom = allowCustom && query.trim().length > 0
    && !filtered.some((o) => o.value.toLowerCase() === query.trim().toLowerCase());

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.field} onPress={() => setOpen(true)} activeOpacity={0.7} testID={testID}>
        <Text style={[styles.fieldText, !value && styles.fieldPlaceholder]} numberOfLines={1}>
          {value || placeholder || 'Select…'}
        </Text>
        <ChevronDown size={18} color={C.textMuted} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={styles.modal}>
          <View style={styles.topBar}>
            <Text style={styles.topTitle} numberOfLines={1}>{label}</Text>
            <TouchableOpacity onPress={() => setOpen(false)}><X size={24} color={C.text} /></TouchableOpacity>
          </View>
          <View style={styles.searchWrap}>
            <Search size={18} color={C.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search…"
              placeholderTextColor={C.textMuted}
              autoFocus
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')}><X size={16} color={C.textMuted} /></TouchableOpacity>
            )}
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.value}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 40 }}
            ListHeaderComponent={showCustom ? (
              <Pressable style={styles.row} onPress={() => handleSelect(query.trim())}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>Use “{query.trim()}”</Text>
                  <Text style={styles.rowSub}>Custom entry</Text>
                </View>
              </Pressable>
            ) : null}
            renderItem={({ item }) => {
              const selected = item.value === value;
              return (
                <Pressable style={[styles.row, selected && styles.rowSelected]} onPress={() => handleSelect(item.value)}>
                  {item.glyph ? <Text style={styles.glyph}>{item.glyph}</Text> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>{item.label}</Text>
                    {item.sublabel ? <Text style={styles.rowSub}>{item.sublabel}</Text> : null}
                  </View>
                  {selected ? <Check size={18} color={C.accent} /> : null}
                </Pressable>
              );
            }}
            ListEmptyComponent={!showCustom ? (
              <Text style={styles.empty}>No matches. Type to add a custom entry.</Text>
            ) : null}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary, marginBottom: 6 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  fieldText: { flex: 1, fontSize: 15, color: C.text },
  fieldPlaceholder: { color: C.textMuted },
  modal: { flex: 1, backgroundColor: C.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  topTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text, flex: 1 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8, margin: 16,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 15, color: C.text, padding: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  rowSelected: { backgroundColor: C.accentDim },
  glyph: { fontSize: 22 },
  rowLabel: { fontSize: 15, fontWeight: '600' as const, color: C.text },
  rowSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  empty: { fontSize: 14, color: C.textSecondary, textAlign: 'center', padding: 30 },
});
