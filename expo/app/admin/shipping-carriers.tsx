import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import C from '@/constants/colors';
import CarrierAccountsManager from '@/components/shipping/CarrierAccountsManager';

export default function AdminShippingCarriersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Platform Carriers</Text>
          <Text style={styles.sub}>Dock2Door-level shipping accounts (fallback for all companies)</Text>
        </View>
      </View>
      <CarrierAccountsManager scope="platform" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  back: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
});
