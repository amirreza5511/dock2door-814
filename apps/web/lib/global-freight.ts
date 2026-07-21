import type { UserRole } from "@/lib/types";

/**
 * Global Freight (Domain 6) shared constants for web — mirror of
 * `expo/constants/globalFreight.ts` + the currency/mode helpers.
 */

export type FreightRoleKind = "customer" | "freight" | "ground" | "admin" | "none";

export const FREIGHT_CUSTOMER_ROLES: UserRole[] = ["ImporterExporter", "Customer", "Guest"];
export const FREIGHT_PROVIDER_ROLES: UserRole[] = ["GlobalFreightForwarder", "Carrier", "FreightForwarder"];
export const FREIGHT_GROUND_ROLES: UserRole[] = ["TruckingCompany", "DrayageCompany"];

export function freightRoleKind(role: UserRole | string | null | undefined): FreightRoleKind {
  if (!role) return "none";
  if (role === "Admin" || role === "SuperAdmin") return "admin";
  if (FREIGHT_PROVIDER_ROLES.includes(role as UserRole)) return "freight";
  if (FREIGHT_GROUND_ROLES.includes(role as UserRole)) return "ground";
  if (FREIGHT_CUSTOMER_ROLES.includes(role as UserRole)) return "customer";
  return "none";
}

export type FreightMode = "air" | "ocean" | "truck" | "fcl" | "lcl";

export const FREIGHT_MODES: { value: FreightMode; label: string; sublabel: string }[] = [
  { value: "air", label: "Air freight", sublabel: "Fastest — airport to airport" },
  { value: "ocean", label: "Ocean freight", sublabel: "Port to port by sea" },
  { value: "truck", label: "Truck / road", sublabel: "Overland by road" },
  { value: "fcl", label: "Full container (FCL/FTL)", sublabel: "A whole container or truck" },
  { value: "lcl", label: "Shared load (LCL)", sublabel: "Share space, pay per volume" },
];

export const FREIGHT_MODE_LABEL: Record<FreightMode, string> = {
  air: "Air", ocean: "Ocean", truck: "Truck", fcl: "FCL / FTL", lcl: "LCL",
};

export type DeliveryMethod = "door_pickup" | "port_delivery" | "booking_only";

export const DELIVERY_METHODS: { value: DeliveryMethod; label: string; sublabel: string }[] = [
  { value: "door_pickup", label: "Door pickup", sublabel: "Collect from my warehouse / address" },
  { value: "port_delivery", label: "Deliver to port / airport", sublabel: "I'll drop cargo at the terminal" },
  { value: "booking_only", label: "Booking only", sublabel: "Just reserve capacity — no pickup" },
];

export const DELIVERY_METHOD_LABEL: Record<DeliveryMethod, string> = {
  door_pickup: "Door pickup", port_delivery: "Port / airport delivery", booking_only: "Booking only",
};

export type FreightDocType = "commercial_invoice" | "packing_list" | "bill_of_lading" | "certificate" | "other";

export const FREIGHT_DOC_TYPES: { value: FreightDocType; label: string }[] = [
  { value: "commercial_invoice", label: "Commercial invoice" },
  { value: "packing_list", label: "Packing list" },
  { value: "bill_of_lading", label: "Bill of lading" },
  { value: "certificate", label: "Certificate" },
  { value: "other", label: "Other document" },
];

export type FreightQuoteStatus = "PendingReview" | "Open" | "Quoted" | "Accepted" | "Rejected" | "Cancelled";

export const FREIGHT_STATUS_META: Record<FreightQuoteStatus, { label: string; className: string }> = {
  PendingReview: { label: "Pending review", className: "bg-amber-500/15 text-amber-300" },
  Open: { label: "Open for quotes", className: "bg-blue-500/15 text-blue-300" },
  Quoted: { label: "Quotes received", className: "bg-blue-500/15 text-blue-300" },
  Accepted: { label: "Accepted", className: "bg-emerald-500/15 text-emerald-300" },
  Rejected: { label: "Rejected", className: "bg-red-500/15 text-red-300" },
  Cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
};

export const CURRENCY_CODES: string[] = ["USD", "CAD", "EUR", "GBP", "AED", "CNY", "JPY", "INR", "AUD", "SGD", "HKD", "KRW", "BRL", "MXN", "ZAR", "SAR", "TRY", "CHF"];

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$", CAD: "C$", EUR: "€", GBP: "£", AED: "د.إ", CNY: "¥", JPY: "¥", INR: "₹",
  AUD: "A$", SGD: "S$", HKD: "HK$", KRW: "₩", BRL: "R$", MXN: "MX$", ZAR: "R", SAR: "﷼", TRY: "₺", CHF: "CHF",
};

export function currencySymbol(code: string | null | undefined): string {
  if (!code) return "$";
  return CURRENCY_SYMBOL[code] ?? code;
}

export function formatMoney(amount: number, code: string | null | undefined): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `${currencySymbol(code)}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/** Curated country list for pickers (name only — free text also allowed). */
export const COUNTRY_NAMES: string[] = [
  "Canada", "United States", "Mexico", "China", "Hong Kong", "Japan", "South Korea", "Singapore",
  "India", "United Arab Emirates", "Saudi Arabia", "United Kingdom", "Germany", "Netherlands",
  "France", "Italy", "Spain", "Belgium", "Turkey", "Australia", "New Zealand", "Brazil",
  "South Africa", "Vietnam", "Thailand", "Malaysia", "Indonesia", "Philippines", "Egypt", "Panama",
];
