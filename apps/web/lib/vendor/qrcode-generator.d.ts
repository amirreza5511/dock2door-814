interface QRCode {
  addData(data: string): void;
  make(): void;
  createSvgTag(opts?: { cellSize?: number; margin?: number; scalable?: boolean }): string;
  createDataURL(cellSize?: number, margin?: number): string;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}

type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

declare function qrcode(typeNumber: number, errorCorrectionLevel: ErrorCorrectionLevel): QRCode;

export default qrcode;
