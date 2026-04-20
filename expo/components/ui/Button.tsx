import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import C from '@/constants/colors';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

export default function Button({ label, onPress, variant = 'primary', size = 'md', loading, disabled, icon, fullWidth }: Props) {
  const variantStyle = {
    primary: { bg: C.accent, text: C.white, border: C.accent },
    secondary: { bg: C.cardElevated, text: C.text, border: C.border },
    ghost: { bg: 'transparent', text: C.textSecondary, border: 'transparent' },
    danger: { bg: C.redDim, text: C.red, border: C.red },
    outline: { bg: 'transparent', text: C.accent, border: C.accent },
  }[variant];

  const sizeStyle = {
    sm: { px: 12, py: 8, fontSize: 13, radius: 8 },
    md: { px: 18, py: 12, fontSize: 15, radius: 10 },
    lg: { px: 24, py: 16, fontSize: 16, radius: 12 },
  }[size];

  return (
    <TouchableOpacity
      testID={`btn-${label}`}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.75}
      style={[
        styles.base,
        {
          backgroundColor: variantStyle.bg,
          borderColor: variantStyle.border,
          paddingHorizontal: sizeStyle.px,
          paddingVertical: sizeStyle.py,
          borderRadius: sizeStyle.radius,
          opacity: disabled ? 0.5 : 1,
        },
        fullWidth && styles.fullWidth,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variantStyle.text} />
      ) : (
        <View style={styles.row}>
          {icon && <View style={styles.iconWrap}>{icon}</View>}
          <Text style={[styles.label, { color: variantStyle.text, fontSize: sizeStyle.fontSize }]}>{label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconWrap: {
    marginRight: 2,
  },
  label: {
    fontWeight: '600' as const,
    letterSpacing: 0.2,
  },
});
