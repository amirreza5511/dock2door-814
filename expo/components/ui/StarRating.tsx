import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Star } from 'lucide-react-native';
import C from '@/constants/colors';

interface Props {
  value: number;
  onChange?: (n: number) => void;
  size?: number;
  readOnly?: boolean;
  testID?: string;
}

export default function StarRating({ value, onChange, size = 22, readOnly, testID }: Props) {
  return (
    <View style={styles.row} testID={testID}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= Math.round(value);
        const Icon = (
          <Star
            size={size}
            color={filled ? C.yellow : C.textMuted}
            fill={filled ? C.yellow : 'transparent'}
          />
        );
        if (readOnly || !onChange) {
          return <View key={n} style={styles.star}>{Icon}</View>;
        }
        return (
          <TouchableOpacity
            key={n}
            onPress={() => onChange(n)}
            style={styles.star}
            testID={`${testID ?? 'star'}-${n}`}
            activeOpacity={0.7}
          >
            {Icon}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  star: { padding: 2 },
});
