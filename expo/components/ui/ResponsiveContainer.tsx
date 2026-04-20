import React from 'react';
import { View, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { useBreakpoint } from '@/hooks/useBreakpoint';

interface ResponsiveContainerProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  testID?: string;
}

export default function ResponsiveContainer({ children, style, padded = true, testID }: ResponsiveContainerProps) {
  const bp = useBreakpoint();
  const horizontalPadding = padded ? (bp.isDesktop ? 40 : bp.isTablet ? 24 : 16) : 0;

  return (
    <View style={[styles.outer, { paddingHorizontal: horizontalPadding }, style]} testID={testID}>
      <View style={[styles.inner, { maxWidth: bp.maxContentWidth, width: '100%' }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, alignItems: 'center' },
  inner: { flex: 1, alignSelf: 'center' },
});
