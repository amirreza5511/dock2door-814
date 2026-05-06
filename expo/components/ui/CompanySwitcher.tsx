import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, FlatList,
} from 'react-native';
import { ChevronDown, Check } from 'lucide-react-native';
import { useActiveCompany, type Membership } from '@/providers/ActiveCompanyProvider';
import C from '@/constants/colors';

/**
 * Renders a company picker when the user belongs to more than one company.
 * Returns null when there is only one (or zero) memberships — no switcher needed.
 */
export default function CompanySwitcher() {
  const { memberships, activeCompany, setActiveCompanyId } = useActiveCompany();
  const [open, setOpen] = useState(false);

  if (memberships.length <= 1) return null;

  const handleSelect = async (m: Membership) => {
    await setActiveCompanyId(m.companyId);
    setOpen(false);
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={styles.trigger}
        activeOpacity={0.75}
        testID="company-switcher-trigger"
      >
        <Text style={styles.triggerText} numberOfLines={1}>
          {activeCompany?.companyName ?? 'Select company'}
        </Text>
        <ChevronDown size={13} color={C.accent} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Switch Company</Text>
            <FlatList<Membership>
              data={memberships}
              keyExtractor={(m) => m.companyId}
              renderItem={({ item }) => {
                const isActive = item.companyId === activeCompany?.companyId;
                return (
                  <TouchableOpacity
                    onPress={() => void handleSelect(item)}
                    style={[styles.row, isActive && styles.rowActive]}
                    activeOpacity={0.75}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName}>{item.companyName}</Text>
                      <Text style={styles.rowMeta}>
                        {item.companyType} · {item.role}
                      </Text>
                    </View>
                    {isActive && <Check size={16} color={C.accent} />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: C.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 160,
  },
  triggerText: {
    fontSize: 12,
    color: C.text,
    fontWeight: '600' as const,
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: C.overlay,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  sheet: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: C.text,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 10,
  },
  rowActive: {
    backgroundColor: C.accentDim,
  },
  rowName: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: C.text,
  },
  rowMeta: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
});
