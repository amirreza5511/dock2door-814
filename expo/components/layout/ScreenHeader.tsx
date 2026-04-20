import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogOut } from 'lucide-react-native';
import C from '@/constants/colors';
import { useAuthStore } from '@/store/auth';

interface Props {
  title: string;
  subtitle?: string;
  rightContent?: React.ReactNode;
  showLogout?: boolean;
}

export default function ScreenHeader({ title, subtitle, rightContent, showLogout }: Props) {
  const insets = useSafeAreaInsets();
  const logout = useAuthStore((s) => s.logout);

  return (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <View style={styles.left}>
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      <View style={styles.right}>
        {rightContent}
        {showLogout && (
          <TouchableOpacity onPress={logout} style={styles.logoutBtn} testID="logout-btn">
            <LogOut size={18} color={C.textMuted} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.bgSecondary,
  },
  left: { flex: 1 },
  title: { fontSize: 22, fontWeight: '700' as const, color: C.text, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoutBtn: {
    width: 36, height: 36,
    borderRadius: 10,
    backgroundColor: C.card,
    borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
});
