import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import C from '@/constants/colors';

interface Props {
  children: React.ReactNode;
  onPress?: () => void;
  style?: object;
  elevated?: boolean;
  noPad?: boolean;
}

export default function Card({ children, onPress, style, elevated, noPad }: Props) {
  const cardStyle = [
    styles.card,
    elevated && styles.elevated,
    noPad && styles.noPad,
    style,
  ];

  if (onPress) {
    return (
      <TouchableOpacity testID="card" activeOpacity={0.8} onPress={onPress} style={cardStyle}>
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={cardStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  elevated: {
    backgroundColor: C.cardElevated,
    borderColor: C.borderLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  noPad: {
    padding: 0,
  },
});
