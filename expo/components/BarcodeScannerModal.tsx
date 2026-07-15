import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Settings, X } from 'lucide-react-native';
import { Linking } from 'react-native';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with the scanned string. Return a message to flash on screen. */
  onScanned: (data: string) => void;
  title?: string;
  subtitle?: string;
  /** Live progress line, e.g. "3 of 5 scanned". */
  progress?: string;
}

/** Full-screen QR/barcode scanner. De-dupes rapid repeat reads of the same code. */
export default function BarcodeScannerModal({ visible, onClose, onScanned, title = 'Scan label', subtitle, progress }: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [flash, setFlash] = useState<string>('');
  const lastRef = useRef<{ data: string; at: number }>({ data: '', at: 0 });

  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [visible, permission, requestPermission]);

  const handleScan = (res: BarcodeScanningResult) => {
    const data = (res.data ?? '').trim();
    if (!data) return;
    const now = Date.now();
    // Ignore the same code re-read within 2s (camera fires continuously).
    if (lastRef.current.data === data && now - lastRef.current.at < 2000) return;
    lastRef.current = { data, at: now };
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setFlash(data);
    setTimeout(() => setFlash(''), 900);
    onScanned(data);
  };

  const denied = permission && !permission.granted && !permission.canAskAgain;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {permission?.granted && Platform.OS !== 'web' ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'pdf417'] }}
            onBarcodeScanned={handleScan}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.fallback]}>
            {Platform.OS === 'web' ? (
              <Text style={styles.fallbackText}>Scanning uses the device camera — open this on your phone to scan labels.</Text>
            ) : denied ? (
              <>
                <Text style={styles.fallbackText}>Camera access is off. Enable it in Settings to scan labels.</Text>
                <Button label="Open settings" onPress={() => void Linking.openSettings()} variant="secondary" icon={<Settings size={14} color={C.text} />} />
              </>
            ) : (
              <Text style={styles.fallbackText}>Requesting camera…</Text>
            )}
          </View>
        )}

        {/* Reticle overlay */}
        <View pointerEvents="none" style={styles.overlay}>
          <View style={styles.reticle} />
          {flash ? <Text style={styles.flash}>Scanned {flash}</Text> : null}
        </View>

        <View style={[styles.top, { paddingTop: insets.top + 10 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}><X size={20} color={C.white} /></TouchableOpacity>
        </View>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
          {progress ? <Text style={styles.progress}>{progress}</Text> : null}
          <Button label="Done" onPress={onClose} fullWidth size="lg" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  fallback: { alignItems: 'center', justifyContent: 'center', padding: 30, gap: 16, backgroundColor: C.bg },
  fallbackText: { color: C.text, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  reticle: { width: 240, height: 240, borderWidth: 3, borderColor: '#ffffffcc', borderRadius: 24, backgroundColor: 'transparent' },
  flash: { marginTop: 20, color: '#fff', fontSize: 15, fontWeight: '800' as const, backgroundColor: '#16a34a', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, overflow: 'hidden' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingBottom: 14 },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' as const },
  subtitle: { color: '#ffffffcc', fontSize: 13, marginTop: 2 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ffffff33', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 18, gap: 12 },
  progress: { color: '#fff', fontSize: 15, fontWeight: '800' as const, textAlign: 'center', backgroundColor: '#00000088', paddingVertical: 8, borderRadius: 10 },
});
