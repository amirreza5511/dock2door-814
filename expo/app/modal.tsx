import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import C from '@/constants/colors';

export default function ModalScreen() {
  return (
    <Pressable style={styles.overlay} onPress={() => router.back()}>
      <View style={styles.modalContent}>
        <Text style={styles.title}>Dock2Door</Text>
        <Text style={styles.description}>
          B2B Logistics Marketplace for Vancouver & Lower Mainland.
        </Text>
        <Pressable style={styles.closeButton} onPress={() => router.back()}>
          <Text style={styles.closeButtonText}>Close</Text>
        </Pressable>
      </View>
      <StatusBar style="light" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: C.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 28,
    margin: 20,
    alignItems: 'center',
    minWidth: 300,
    borderWidth: 1,
    borderColor: C.border,
  },
  title: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: C.text,
    marginBottom: 12,
  },
  description: {
    textAlign: 'center',
    marginBottom: 24,
    color: C.textSecondary,
    lineHeight: 20,
    fontSize: 14,
  },
  closeButton: {
    backgroundColor: C.accent,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    minWidth: 100,
  },
  closeButtonText: {
    color: C.white,
    fontWeight: '600' as const,
    textAlign: 'center',
    fontSize: 15,
  },
});
