import React, { useMemo } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { qrSvgString } from '@/lib/qr';

interface Props {
  value: string;
  size?: number;
  /** Quiet-zone modules around the code. */
  margin?: number;
}

/** Offline QR code rendered from a pure-JS matrix (no native module). */
function QRCode({ value, size = 120, margin = 0 }: Props) {
  const xml = useMemo(() => {
    try {
      // cellSize is arbitrary here; SvgXml scales to width/height.
      return qrSvgString(value, 4, margin);
    } catch {
      return '';
    }
  }, [value, margin]);

  if (!xml) return <View style={{ width: size, height: size }} />;
  return <SvgXml xml={xml} width={size} height={size} />;
}

export default React.memo(QRCode);
