import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import C from '@/constants/colors';

interface Props {
  title: string;
  action?: string;
  onAction?: () => void;
}

export default function SectionHeader({ title, action, onAction }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {action && onAction && (
        <TouchableOpacity onPress={onAction}>
          <Text style={styles.action}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: '700' as const, color: C.text, letterSpacing: -0.2 },
  action: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
});
