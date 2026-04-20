import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';

interface ScreenFeedbackProps {
  state: 'loading' | 'error';
  title?: string;
  description?: string;
  onRetry?: () => void;
  testID?: string;
}

export default function ScreenFeedback({ state, title, description, onRetry, testID }: ScreenFeedbackProps) {
  if (state === 'loading') {
    return (
      <View style={styles.root} testID={testID ?? 'screen-loading'}>
        <ActivityIndicator size="small" color={C.accent} />
        <Text style={styles.title}>{title ?? 'Loading'}</Text>
        <Text style={styles.description}>{description ?? 'Fetching the latest live data.'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root} testID={testID ?? 'screen-error'}>
      <View style={styles.errorIconWrap}>
        <AlertTriangle size={22} color={C.red} />
      </View>
      <Text style={styles.title}>{title ?? 'Something went wrong'}</Text>
      <Text style={styles.description}>{description ?? 'Please try again.'}</Text>
      {onRetry ? <Button label="Retry" onPress={onRetry} variant="secondary" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 20,
    paddingVertical: 28,
    gap: 10,
  },
  errorIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: C.redDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: C.text,
  },
  description: {
    fontSize: 13,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
