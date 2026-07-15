import { qrDataUrl } from "@/lib/qr";

export interface PieceInfo {
  piece_no: number;
  total_pieces: number;
  barcode: string;
  cargo_class: string;
  weight_kg: number;
}

export interface ShipmentInfo {
  bolNumber: string;
  pickupAddress: string;
  dropoffAddress: string;
  senderName: string;
  recipientName: string;
  recipientPhone: string;
  cargoClassLabel: string;
  vehicleLabel: string;
  pallets: number;
  itemCount: number;
  weightKg: number;
  distanceKm: number;
  totalPrice: number;
  itemDescription: string;
  notes: string;
  createdAt: string;
}

export interface DeliveryInfo {
  receiverName: string;
  deliveredAt: string;
  signatureDataUrl: string;
  photoDataUrl: string;
}

const esc = (s: string): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );

/** One printable 4x6-style label per piece, each on its own page. */
export function buildLabelsHtml(shipment: ShipmentInfo, pieces: PieceInfo[]): string {
  const labels = pieces
    .map((p) => {
      const qr = qrDataUrl(p.barcode, 6, 1);
      return `
      <div class="label">
        <div class="l-top">
          <div class="l-bol">${esc(shipment.bolNumber)}</div>
          <div class="l-count">${p.piece_no} <span>of ${p.total_pieces}</span></div>
        </div>
        <div class="l-mid">
          <div class="l-addr">
            <div class="l-row"><span class="l-tag">FROM</span> ${esc(shipment.pickupAddress || "—")}</div>
            <div class="l-row"><span class="l-tag to">TO</span> ${esc(shipment.dropoffAddress || "—")}</div>
            <div class="l-names">${esc(shipment.senderName || "Shipper")} → ${esc(shipment.recipientName || "Receiver")}</div>
          </div>
          <img class="l-qr" src="${qr}" alt="QR" />
        </div>
        <div class="l-bottom">
          <span class="l-class">${esc(shipment.cargoClassLabel)}</span>
          <span class="l-code">${esc(p.barcode)}</span>
        </div>
      </div>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(shipment.bolNumber)} — Labels</title>
  <style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; font-family: -apple-system, Helvetica, Arial, sans-serif; color: #0b0f17; }
    .label { page-break-after: always; padding: 22px; border: 3px solid #0b0f17; border-radius: 14px; margin: 12px; height: 92vh; display: flex; flex-direction: column; justify-content: space-between; }
    .l-top { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #0b0f17; padding-bottom: 12px; }
    .l-bol { font-size: 30px; font-weight: 800; letter-spacing: -0.5px; }
    .l-count { font-size: 46px; font-weight: 900; line-height: 1; }
    .l-count span { font-size: 20px; font-weight: 600; color: #6b7280; }
    .l-mid { display: flex; gap: 18px; align-items: center; flex: 1; padding: 18px 0; }
    .l-addr { flex: 1; }
    .l-row { font-size: 22px; margin-bottom: 12px; line-height: 1.3; }
    .l-tag { display: inline-block; background: #0b0f17; color: #fff; font-size: 13px; font-weight: 800; padding: 3px 8px; border-radius: 6px; margin-right: 8px; vertical-align: middle; }
    .l-tag.to { background: #dc2626; }
    .l-names { font-size: 16px; color: #374151; margin-top: 8px; font-weight: 600; }
    .l-qr { width: 190px; height: 190px; }
    .l-bottom { display: flex; justify-content: space-between; align-items: center; border-top: 3px solid #0b0f17; padding-top: 12px; }
    .l-class { font-size: 20px; font-weight: 800; }
    .l-code { font-family: 'Courier New', monospace; font-size: 18px; font-weight: 700; letter-spacing: 1px; }
    @media print { .label { margin: 0; height: 100vh; border-radius: 0; } }
  </style></head><body>${labels}</body></html>`;
}

/** The master Bill of Lading document. */
export function buildBolHtml(shipment: ShipmentInfo, pieces: PieceInfo[]): string {
  const masterQr = qrDataUrl(shipment.bolNumber, 6, 1);
  const rows = pieces
    .map(
      (p) => `<tr>
        <td>${p.piece_no} / ${p.total_pieces}</td>
        <td style="font-family:'Courier New',monospace">${esc(p.barcode)}</td>
        <td>${esc(shipment.cargoClassLabel)}</td>
        <td style="text-align:right">${Number(p.weight_kg).toFixed(1)} kg</td>
      </tr>`,
    )
    .join("");

  const dateStr = (() => {
    try { return new Date(shipment.createdAt).toLocaleString(); } catch { return shipment.createdAt; }
  })();

  return `<!doctype html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(shipment.bolNumber)} — Bill of Lading</title>
  <style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; padding: 28px; font-family: -apple-system, Helvetica, Arial, sans-serif; color: #0b0f17; font-size: 13px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 4px solid #0b0f17; padding-bottom: 16px; }
    .title { font-size: 26px; font-weight: 900; letter-spacing: -0.5px; }
    .sub { font-size: 13px; color: #6b7280; margin-top: 2px; }
    .bol-no { font-size: 20px; font-weight: 800; margin-top: 8px; }
    .qr { width: 110px; height: 110px; }
    .grid { display: flex; gap: 16px; margin-top: 20px; }
    .box { flex: 1; border: 1.5px solid #d1d5db; border-radius: 10px; padding: 14px; }
    .box h3 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.6px; color: #6b7280; }
    .box .v { font-size: 15px; font-weight: 600; line-height: 1.4; }
    .meta { display: flex; flex-wrap: wrap; gap: 10px 26px; margin-top: 20px; }
    .meta div { font-size: 13px; }
    .meta b { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 22px; }
    th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
    th { background: #0b0f17; color: #fff; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .totals { margin-top: 18px; text-align: right; font-size: 18px; font-weight: 800; }
    .sign { display: flex; gap: 24px; margin-top: 40px; }
    .sign .s { flex: 1; border-top: 2px solid #0b0f17; padding-top: 8px; font-size: 12px; color: #6b7280; }
    .foot { margin-top: 30px; font-size: 11px; color: #9ca3af; text-align: center; }
  </style></head><body>
    <div class="head">
      <div>
        <div class="title">BILL OF LADING</div>
        <div class="sub">Non-negotiable · Straight bill of lading</div>
        <div class="bol-no">${esc(shipment.bolNumber)}</div>
        <div class="sub">${esc(dateStr)}</div>
      </div>
      <img class="qr" src="${masterQr}" alt="QR"/>
    </div>

    <div class="grid">
      <div class="box"><h3>Shipper (From)</h3><div class="v">${esc(shipment.senderName || "—")}<br/>${esc(shipment.pickupAddress || "—")}</div></div>
      <div class="box"><h3>Consignee (To)</h3><div class="v">${esc(shipment.recipientName || "—")}<br/>${esc(shipment.recipientPhone || "")}<br/>${esc(shipment.dropoffAddress || "—")}</div></div>
    </div>

    <div class="meta">
      <div><b>Cargo class</b>${esc(shipment.cargoClassLabel)}</div>
      <div><b>Vehicle</b>${esc(shipment.vehicleLabel)}</div>
      <div><b>Pieces</b>${pieces.length}</div>
      <div><b>Pallets</b>${shipment.pallets}</div>
      <div><b>Total weight</b>${Number(shipment.weightKg).toFixed(1)} kg</div>
      <div><b>Distance</b>${Number(shipment.distanceKm).toFixed(0)} km</div>
    </div>
    ${shipment.itemDescription ? `<div class="meta"><div style="flex:1"><b>Description of goods</b>${esc(shipment.itemDescription)}</div></div>` : ""}

    <table>
      <thead><tr><th>Piece</th><th>Barcode</th><th>Class</th><th style="text-align:right">Weight</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="totals">Declared charges: $${Number(shipment.totalPrice).toFixed(2)}</div>
    ${shipment.notes ? `<div class="meta"><div style="flex:1"><b>Notes</b>${esc(shipment.notes)}</div></div>` : ""}

    <div class="sign">
      <div class="s">Shipper signature &amp; date</div>
      <div class="s">Driver signature &amp; date</div>
      <div class="s">Consignee signature &amp; date</div>
    </div>

    <div class="foot">Generated by the freight platform · Keep this document with the shipment until delivery is complete.</div>
  </body></html>`;
}

/** The finalized Bill of Lading — includes the delivery proof stamp, signature and photo. */
export function buildDeliveredBolHtml(shipment: ShipmentInfo, pieces: PieceInfo[], delivery: DeliveryInfo): string {
  const masterQr = qrDataUrl(shipment.bolNumber, 6, 1);
  const deliveredStr = (() => {
    try { return new Date(delivery.deliveredAt).toLocaleString(); } catch { return delivery.deliveredAt; }
  })();
  const rows = pieces
    .map(
      (p) => `<tr>
        <td>${p.piece_no} / ${p.total_pieces}</td>
        <td style="font-family:'Courier New',monospace">${esc(p.barcode)}</td>
        <td>${esc(shipment.cargoClassLabel)}</td>
        <td style="text-align:right">${Number(p.weight_kg).toFixed(1)} kg</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(shipment.bolNumber)} — Proof of Delivery</title>
  <style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; padding: 28px; font-family: -apple-system, Helvetica, Arial, sans-serif; color: #0b0f17; font-size: 13px; position: relative; }
    .stamp { position: absolute; top: 90px; right: 40px; border: 4px solid #16a34a; color: #16a34a; font-weight: 900; font-size: 26px; letter-spacing: 2px; padding: 8px 18px; border-radius: 10px; transform: rotate(-12deg); opacity: 0.92; }
    .stamp small { display: block; font-size: 11px; letter-spacing: 0.5px; text-align: center; margin-top: 2px; font-weight: 700; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 4px solid #0b0f17; padding-bottom: 16px; }
    .title { font-size: 26px; font-weight: 900; letter-spacing: -0.5px; }
    .sub { font-size: 13px; color: #6b7280; margin-top: 2px; }
    .bol-no { font-size: 20px; font-weight: 800; margin-top: 8px; }
    .qr { width: 110px; height: 110px; }
    .grid { display: flex; gap: 16px; margin-top: 20px; }
    .box { flex: 1; border: 1.5px solid #d1d5db; border-radius: 10px; padding: 14px; }
    .box h3 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.6px; color: #6b7280; }
    .box .v { font-size: 15px; font-weight: 600; line-height: 1.4; }
    .meta { display: flex; flex-wrap: wrap; gap: 10px 26px; margin-top: 20px; }
    .meta div { font-size: 13px; }
    .meta b { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 22px; }
    th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
    th { background: #0b0f17; color: #fff; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .totals { margin-top: 18px; text-align: right; font-size: 18px; font-weight: 800; }
    .pod { margin-top: 34px; border: 2px solid #16a34a; border-radius: 14px; padding: 18px; background: #f0fdf4; }
    .pod h3 { margin: 0 0 14px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.6px; color: #16a34a; }
    .pod-grid { display: flex; gap: 20px; align-items: flex-start; }
    .pod-col { flex: 1; }
    .pod-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 700; margin-bottom: 6px; }
    .pod-name { font-size: 18px; font-weight: 800; }
    .pod-time { font-size: 13px; color: #374151; margin-top: 4px; }
    .sig-box { border: 1px solid #d1d5db; padding: 6px; min-height: 90px; background: #fff; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
    .sig-box img { max-width: 100%; max-height: 100px; }
    .pod-photo { width: 100%; max-width: 240px; border-radius: 10px; border: 1px solid #d1d5db; }
    .foot { margin-top: 30px; font-size: 11px; color: #9ca3af; text-align: center; }
    @media print { .stamp { opacity: 1; } }
  </style></head><body>
    <div class="stamp">DELIVERED<small>${esc(deliveredStr)}</small></div>
    <div class="head">
      <div>
        <div class="title">BILL OF LADING</div>
        <div class="sub">Non-negotiable · Proof of delivery</div>
        <div class="bol-no">${esc(shipment.bolNumber)}</div>
      </div>
      <img class="qr" src="${masterQr}" alt="QR"/>
    </div>

    <div class="grid">
      <div class="box"><h3>Shipper (From)</h3><div class="v">${esc(shipment.senderName || "—")}<br/>${esc(shipment.pickupAddress || "—")}</div></div>
      <div class="box"><h3>Consignee (To)</h3><div class="v">${esc(shipment.recipientName || "—")}<br/>${esc(shipment.recipientPhone || "")}<br/>${esc(shipment.dropoffAddress || "—")}</div></div>
    </div>

    <div class="meta">
      <div><b>Cargo class</b>${esc(shipment.cargoClassLabel)}</div>
      <div><b>Vehicle</b>${esc(shipment.vehicleLabel)}</div>
      <div><b>Pieces</b>${pieces.length}</div>
      <div><b>Total weight</b>${Number(shipment.weightKg).toFixed(1)} kg</div>
      <div><b>Distance</b>${Number(shipment.distanceKm).toFixed(0)} km</div>
    </div>

    <table>
      <thead><tr><th>Piece</th><th>Barcode</th><th>Class</th><th style="text-align:right">Weight</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="totals">Declared charges: $${Number(shipment.totalPrice).toFixed(2)}</div>

    <div class="pod">
      <h3>Proof of delivery</h3>
      <div class="pod-grid">
        <div class="pod-col">
          <div class="pod-label">Received by</div>
          <div class="pod-name">${esc(delivery.receiverName || "—")}</div>
          <div class="pod-time">${esc(deliveredStr)}</div>
          <div class="pod-label" style="margin-top:16px">Signature</div>
          <div class="sig-box">${delivery.signatureDataUrl ? `<img src="${delivery.signatureDataUrl}" alt="Signature"/>` : '<span style="color:#9ca3af;font-size:12px">No signature captured</span>'}</div>
        </div>
        <div class="pod-col">
          <div class="pod-label">Delivery photo</div>
          ${delivery.photoDataUrl ? `<img class="pod-photo" src="${delivery.photoDataUrl}" alt="Delivery"/>` : '<div style="color:#9ca3af;font-size:12px">No photo captured</div>'}
        </div>
      </div>
    </div>

    <div class="foot">Generated by the freight platform · This finalized Bill of Lading confirms the shipment was delivered and signed for.</div>
  </body></html>`;
}

/** Open an HTML document in a new window and trigger the print dialog. */
export function printHtml(html: string): void {
  const w = window.open("", "_blank", "width=820,height=900");
  if (!w) {
    window.alert("Please allow pop-ups to print.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Give images (QR data URLs) a tick to render before printing.
  w.onload = () => {
    setTimeout(() => {
      w.focus();
      w.print();
    }, 250);
  };
}
