import React from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import C from '@/constants/colors';

interface Props {
  children: React.ReactNode;
  onPress?: () => void;
  style?: object;
  elevated?: boolean;
  noPad?: boolean;
  testID?: string;
}

export default function Card({ children, onPress, style, elevated, noPad, testID }: Props) {
  const cardStyle = [
    styles.card,
    elevated && styles.elevated,
    noPad && styles.noPad,
    style,
  ];
  const safeChildren = React.Children.map(children, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      const value = String(child);
      return value.trim().length > 0 ? <Text style={styles.inlineText}>{value}</Text> : null;
    }
    return child;
  });

  if (onPress) {
    return (
      <TouchableOpacity testID={testID ?? 'card'} activeOpacity={0.8} onPress={onPress} style={cardStyle}>
        {safeChildren}
      </TouchableOpacity>
    );
  }

  return <View style={cardStyle} testID={testID}>{safeChildren}</View>;
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
  inlineText: {
    color: C.text,
    fontSize: 14,
  },
});
