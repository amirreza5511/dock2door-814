import qrcode from 'qrcode-generator';

/** Build a QR code as an inline SVG string (for react-native-svg's SvgXml). */
export function qrSvgString(value: string, cellSize = 4, margin = 0): string {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  return qr.createSvgTag({ cellSize, margin });
}

/** Build a QR code as a self-contained data URL (GIF) — safe to embed in print HTML. */
export function qrDataUrl(value: string, cellSize = 4, margin = 1): string {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  return qr.createDataURL(cellSize, margin);
}
