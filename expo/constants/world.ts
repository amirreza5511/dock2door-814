/**
 * Worldwide reference data + unit helpers shared across freight flows.
 *
 * - CURRENCIES: the currencies customers/forwarders can quote in, with symbol.
 * - COUNTRIES: ISO-ish country list for origin/destination pickers.
 * - SEAPORTS / AIRPORTS: major hubs for ocean & air pickers (searchable).
 * - Unit converters: kg/lb and cm/in, plus a metric/imperial system type.
 *
 * These are intentionally curated (not exhaustive) but cover the world's main
 * trade lanes. Pickers allow free-text too, so anything missing can be typed.
 */

// ── Currencies ──────────────────────────────────────────────────────────────
export interface CurrencyDef {
  code: string;
  symbol: string;
  name: string;
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar' },
  { code: 'KRW', symbol: '₩', name: 'South Korean Won' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
  { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
  { code: 'SAR', symbol: '﷼', name: 'Saudi Riyal' },
  { code: 'TRY', symbol: '₺', name: 'Turkish Lira' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
];

export const CURRENCY_CODES: string[] = CURRENCIES.map((c) => c.code);

const CURRENCY_BY_CODE: Record<string, CurrencyDef> = CURRENCIES.reduce((acc, c) => {
  acc[c.code] = c;
  return acc;
}, {} as Record<string, CurrencyDef>);

/** Symbol for a currency code, falling back to the raw code. */
export function currencySymbol(code: string | null | undefined): string {
  if (!code) return '$';
  return CURRENCY_BY_CODE[code]?.symbol ?? code;
}

/** Format an amount with its currency symbol, e.g. formatMoney(2400,'EUR') → "€2,400". */
export function formatMoney(amount: number, code: string | null | undefined): string {
  const sym = currencySymbol(code);
  const n = Number.isFinite(amount) ? amount : 0;
  return `${sym}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// ── Units ───────────────────────────────────────────────────────────────────
export type UnitSystem = 'metric' | 'imperial';

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;

export const kgToLb = (kg: number): number => kg / KG_PER_LB;
export const lbToKg = (lb: number): number => lb * KG_PER_LB;
export const cmToIn = (cm: number): number => cm / CM_PER_IN;
export const inToCm = (inch: number): number => inch * CM_PER_IN;

export const weightUnitFor = (system: UnitSystem): 'kg' | 'lb' => (system === 'metric' ? 'kg' : 'lb');
export const dimUnitFor = (system: UnitSystem): 'cm' | 'in' => (system === 'metric' ? 'cm' : 'in');

// ── Countries ─────────────────────────────────────────────────────────────��─
export interface CountryDef {
  code: string;
  name: string;
  flag: string;
}

export const COUNTRIES: CountryDef[] = [
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
  { code: 'CN', name: 'China', flag: '🇨🇳' },
  { code: 'HK', name: 'Hong Kong', flag: '🇭🇰' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  { code: 'BE', name: 'Belgium', flag: '🇧🇪' },
  { code: 'TR', name: 'Turkey', flag: '🇹🇷' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
  { code: 'VN', name: 'Vietnam', flag: '🇻🇳' },
  { code: 'TH', name: 'Thailand', flag: '🇹🇭' },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩' },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭' },
  { code: 'EG', name: 'Egypt', flag: '🇪🇬' },
  { code: 'PA', name: 'Panama', flag: '🇵🇦' },
];

// ── Seaports ──────────────────────────────────────────────────────────────────
export interface PortDef {
  code: string;
  name: string;
  country: string;
}

/** Major container seaports (UN/LOCODE-style codes). */
export const SEAPORTS: PortDef[] = [
  { code: 'CNSHA', name: 'Shanghai', country: 'CN' },
  { code: 'CNNGB', name: 'Ningbo-Zhoushan', country: 'CN' },
  { code: 'CNSZX', name: 'Shenzhen', country: 'CN' },
  { code: 'CNCAN', name: 'Guangzhou', country: 'CN' },
  { code: 'CNTAO', name: 'Qingdao', country: 'CN' },
  { code: 'HKHKG', name: 'Hong Kong', country: 'HK' },
  { code: 'SGSIN', name: 'Singapore', country: 'SG' },
  { code: 'KRPUS', name: 'Busan', country: 'KR' },
  { code: 'JPTYO', name: 'Tokyo', country: 'JP' },
  { code: 'JPYOK', name: 'Yokohama', country: 'JP' },
  { code: 'MYPKG', name: 'Port Klang', country: 'MY' },
  { code: 'MYTPP', name: 'Tanjung Pelepas', country: 'MY' },
  { code: 'VNSGN', name: 'Ho Chi Minh (Cat Lai)', country: 'VN' },
  { code: 'VNHPH', name: 'Haiphong', country: 'VN' },
  { code: 'THLCH', name: 'Laem Chabang', country: 'TH' },
  { code: 'IDJKT', name: 'Jakarta (Tanjung Priok)', country: 'ID' },
  { code: 'INNSA', name: 'Nhava Sheva (JNPT)', country: 'IN' },
  { code: 'INMAA', name: 'Chennai', country: 'IN' },
  { code: 'INMUN', name: 'Mundra', country: 'IN' },
  { code: 'AEJEA', name: 'Jebel Ali (Dubai)', country: 'AE' },
  { code: 'SAJED', name: 'Jeddah', country: 'SA' },
  { code: 'EGPSD', name: 'Port Said', country: 'EG' },
  { code: 'NLRTM', name: 'Rotterdam', country: 'NL' },
  { code: 'BEANR', name: 'Antwerp', country: 'BE' },
  { code: 'DEHAM', name: 'Hamburg', country: 'DE' },
  { code: 'DEBRV', name: 'Bremerhaven', country: 'DE' },
  { code: 'GBFXT', name: 'Felixstowe', country: 'GB' },
  { code: 'GBLGP', name: 'London Gateway', country: 'GB' },
  { code: 'ESVLC', name: 'Valencia', country: 'ES' },
  { code: 'ESALG', name: 'Algeciras', country: 'ES' },
  { code: 'ITGOA', name: 'Genoa', country: 'IT' },
  { code: 'FRLEH', name: 'Le Havre', country: 'FR' },
  { code: 'TRIST', name: 'Istanbul (Ambarli)', country: 'TR' },
  { code: 'USLAX', name: 'Los Angeles', country: 'US' },
  { code: 'USLGB', name: 'Long Beach', country: 'US' },
  { code: 'USNYC', name: 'New York / New Jersey', country: 'US' },
  { code: 'USSAV', name: 'Savannah', country: 'US' },
  { code: 'USSEA', name: 'Seattle-Tacoma', country: 'US' },
  { code: 'USHOU', name: 'Houston', country: 'US' },
  { code: 'USOAK', name: 'Oakland', country: 'US' },
  { code: 'CAVAN', name: 'Vancouver', country: 'CA' },
  { code: 'CAPRR', name: 'Prince Rupert', country: 'CA' },
  { code: 'CAMTR', name: 'Montreal', country: 'CA' },
  { code: 'CAHAL', name: 'Halifax', country: 'CA' },
  { code: 'MXZLO', name: 'Manzanillo', country: 'MX' },
  { code: 'MXLZC', name: 'Lazaro Cardenas', country: 'MX' },
  { code: 'BRSSZ', name: 'Santos', country: 'BR' },
  { code: 'ZADUR', name: 'Durban', country: 'ZA' },
  { code: 'AUMEL', name: 'Melbourne', country: 'AU' },
  { code: 'AUSYD', name: 'Sydney', country: 'AU' },
  { code: 'PABLB', name: 'Balboa', country: 'PA' },
];

// ── Airports ──────────────────────────────────────────────────────────────────
export interface AirportDef {
  code: string;
  name: string;
  city: string;
  country: string;
}

/** Major air-cargo airports (IATA codes). */
export const AIRPORTS: AirportDef[] = [
  { code: 'HKG', name: 'Hong Kong Intl', city: 'Hong Kong', country: 'HK' },
  { code: 'PVG', name: 'Shanghai Pudong', city: 'Shanghai', country: 'CN' },
  { code: 'PEK', name: 'Beijing Capital', city: 'Beijing', country: 'CN' },
  { code: 'CAN', name: 'Guangzhou Baiyun', city: 'Guangzhou', country: 'CN' },
  { code: 'ICN', name: 'Seoul Incheon', city: 'Seoul', country: 'KR' },
  { code: 'NRT', name: 'Tokyo Narita', city: 'Tokyo', country: 'JP' },
  { code: 'SIN', name: 'Singapore Changi', city: 'Singapore', country: 'SG' },
  { code: 'BKK', name: 'Bangkok Suvarnabhumi', city: 'Bangkok', country: 'TH' },
  { code: 'DEL', name: 'Delhi Indira Gandhi', city: 'Delhi', country: 'IN' },
  { code: 'BOM', name: 'Mumbai Chhatrapati Shivaji', city: 'Mumbai', country: 'IN' },
  { code: 'DXB', name: 'Dubai Intl', city: 'Dubai', country: 'AE' },
  { code: 'AUH', name: 'Abu Dhabi Intl', city: 'Abu Dhabi', country: 'AE' },
  { code: 'DOH', name: 'Doha Hamad', city: 'Doha', country: 'SA' },
  { code: 'IST', name: 'Istanbul Airport', city: 'Istanbul', country: 'TR' },
  { code: 'FRA', name: 'Frankfurt am Main', city: 'Frankfurt', country: 'DE' },
  { code: 'AMS', name: 'Amsterdam Schiphol', city: 'Amsterdam', country: 'NL' },
  { code: 'CDG', name: 'Paris Charles de Gaulle', city: 'Paris', country: 'FR' },
  { code: 'LHR', name: 'London Heathrow', city: 'London', country: 'GB' },
  { code: 'LGG', name: 'Liege', city: 'Liege', country: 'BE' },
  { code: 'MAD', name: 'Madrid Barajas', city: 'Madrid', country: 'ES' },
  { code: 'MXP', name: 'Milan Malpensa', city: 'Milan', country: 'IT' },
  { code: 'JFK', name: 'New York JFK', city: 'New York', country: 'US' },
  { code: 'ORD', name: 'Chicago O\u2019Hare', city: 'Chicago', country: 'US' },
  { code: 'LAX', name: 'Los Angeles Intl', city: 'Los Angeles', country: 'US' },
  { code: 'MIA', name: 'Miami Intl', city: 'Miami', country: 'US' },
  { code: 'ATL', name: 'Atlanta Hartsfield-Jackson', city: 'Atlanta', country: 'US' },
  { code: 'DFW', name: 'Dallas/Fort Worth', city: 'Dallas', country: 'US' },
  { code: 'ANC', name: 'Anchorage Ted Stevens', city: 'Anchorage', country: 'US' },
  { code: 'YYZ', name: 'Toronto Pearson', city: 'Toronto', country: 'CA' },
  { code: 'YVR', name: 'Vancouver Intl', city: 'Vancouver', country: 'CA' },
  { code: 'YUL', name: 'Montreal Trudeau', city: 'Montreal', country: 'CA' },
  { code: 'MEX', name: 'Mexico City Intl', city: 'Mexico City', country: 'MX' },
  { code: 'GRU', name: 'Sao Paulo Guarulhos', city: 'Sao Paulo', country: 'BR' },
  { code: 'JNB', name: 'Johannesburg OR Tambo', city: 'Johannesburg', country: 'ZA' },
  { code: 'SYD', name: 'Sydney Kingsford Smith', city: 'Sydney', country: 'AU' },
  { code: 'SGN', name: 'Ho Chi Minh Tan Son Nhat', city: 'Ho Chi Minh City', country: 'VN' },
  { code: 'KUL', name: 'Kuala Lumpur Intl', city: 'Kuala Lumpur', country: 'MY' },
  { code: 'CGK', name: 'Jakarta Soekarno-Hatta', city: 'Jakarta', country: 'ID' },
  { code: 'MNL', name: 'Manila Ninoy Aquino', city: 'Manila', country: 'PH' },
];
