import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Print from 'expo-print';
import * as Haptics from 'expo-haptics';
import {
  Package, MapPin, User, Scale, Calendar, Truck, Store, CheckCircle2,
  Printer, Search, ChevronRight, CreditCard, RotateCcw, ScanLine,
} from 'lucide-react-native';
import Input from '@/components/ui/Input';
import TrackingCode from '@/components/TrackingCode';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { searchWeb } from '@/lib/ai';

/** Which conversational flow this card drives. */
export type ParcelFlow = 'send' | 'return';

interface Props {
  flow: ParcelFlow;
  /** Prefilled hints the AI extracted from the conversation. */
  params: Record<string, unknown>;
  /** Append a persistent assistant message to the chat when a step completes. */
  onComplete: (summary: string, link?: { href: string; label: string }) => void;
  /** Role-aware screen where the user can watch a dispatched driver. */
  trackHref: string;
}

type SendStep = 'form' | 'review' | 'label';
type ReturnStep = 'form' | 'done';

type DeliveryMethod = 'dropoff' | 'pickup';
type ReturnMode = 'scan' | 'printed';

function s(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  return typeof v === 'string' ? v : v != null && typeof v === 'number' ? String(v) : '';
}

/** Pick the right vehicle class from parcel weight so pickup pricing is sane. */
function vehicleForWeight(kg: number): string {
  if (kg <= 20) return 'Car';
  if (kg <= 100) return 'Pickup';
  if (kg <= 800) return 'MovingTruck';
  return 'FiveTon';
}

interface QuoteShape {
  chargeable_kg?: number;
  price?: number;
  currency?: string;
}

/**
 * An in-chat, fillable shipping intake card. The AI opens it prefilled with
 * whatever it already gathered; the user completes the blanks and submits
 * without ever leaving the conversation. Handles both outbound parcels
 * (quote → pay → printable barcode/label → drop-off or driver pickup) and
 * store returns (Amazon/Temu/Shopify — scan or printed label → driver pickup).
 */
export default function ParcelIntakeCard({ flow, params, onComplete, trackHref }: Props) {
  const parcelQuote = trpc.parcel.quote.useMutation();
  const parcelCreate = trpc.parcel.create.useMutation();
  const postLoad = trpc.loads.post.useMutation();

  const [sendStep, setSendStep] = useState<SendStep>('form');
  const [returnStep, setReturnStep] = useState<ReturnStep>('form');
  const [busy, setBusy] = useState<boolean>(false);
  const [errText, setErrText] = useState<string>('');

  // Sender
  const [fromName, setFromName] = useState<string>(s(params, 'fromName'));
  const [fromPhone, setFromPhone] = useState<string>(s(params, 'fromPhone'));
  const [fromLine1, setFromLine1] = useState<string>(s(params, 'fromLine1') || s(params, 'fromAddress'));
  const [fromCity, setFromCity] = useState<string>(s(params, 'fromCity'));
  const [fromRegion, setFromRegion] = useState<string>(s(params, 'fromRegion'));
  const [fromPostal, setFromPostal] = useState<string>(s(params, 'fromPostal'));
  // Recipient
  const [toName, setToName] = useState<string>(s(params, 'toName'));
  const [toPhone, setToPhone] = useState<string>(s(params, 'toPhone'));
  const [toLine1, setToLine1] = useState<string>(s(params, 'toLine1') || s(params, 'toAddress'));
  const [toCity, setToCity] = useState<string>(s(params, 'toCity'));
  const [toRegion, setToRegion] = useState<string>(s(params, 'toRegion'));
  const [toPostal, setToPostal] = useState<string>(s(params, 'toPostal'));
  // Item
  const [commodity, setCommodity] = useState<string>(s(params, 'commodity') || s(params, 'item'));
  const [weight, setWeight] = useState<string>(s(params, 'weight') || s(params, 'weightKg'));
  const [lengthCm, setLengthCm] = useState<string>(s(params, 'length'));
  const [widthCm, setWidthCm] = useState<string>(s(params, 'width'));
  const [heightCm, setHeightCm] = useState<string>(s(params, 'height'));
  const [readyDate, setReadyDate] = useState<string>(s(params, 'readyDate'));

  const initialMethod: DeliveryMethod = s(params, 'deliveryMethod') === 'pickup' ? 'pickup' : 'dropoff';
  const [method, setMethod] = useState<DeliveryMethod>(initialMethod);
  const initialMode: ReturnMode = s(params, 'returnLabelMode') === 'printed' ? 'printed' : 'scan';
  const [returnMode, setReturnMode] = useState<ReturnMode>(initialMode);
  const [platform, setPlatform] = useState<string>(s(params, 'platform') || 'Amazon');

  const [quote, setQuote] = useState<QuoteShape | null>(null);
  const [tracking, setTracking] = useState<string>('');
  const [postOffice, setPostOffice] = useState<string>('');
  const [poLoading, setPoLoading] = useState<boolean>(false);

  const weightNum = useMemo(() => {
    const n = Number(weight);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [weight]);

  const num = (v: string): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  // ── Validation ──
  const missing = useMemo(() => {
    const m: string[] = [];
    if (flow === 'return') {
      if (!fromName.trim()) m.push('نام شما');
      if (!fromCity.trim()) m.push('شهر شما');
      if (!fromLine1.trim()) m.push('آدرس شما');
      if (!commodity.trim()) m.push('کالا');
      return m;
    }
    if (!fromCity.trim()) m.push('شهر فرستنده');
    if (!toName.trim()) m.push('نام گیرنده');
    if (!toCity.trim()) m.push('شهر گیرنده');
    if (weightNum <= 0) m.push('وزن');
    if (!commodity.trim()) m.push('کالا');
    return m;
  }, [flow, fromName, fromCity, fromLine1, toName, toCity, commodity, weightNum]);

  const canContinue = missing.length === 0;

  // ── SEND: form → review (fetch quote) ──
  const goReview = useCallback(async () => {
    if (!canContinue || busy) return;
    setBusy(true);
    setErrText('');
    try {
      const q = await parcelQuote.mutateAsync({
        length: num(lengthCm), width: num(widthCm), height: num(heightCm),
        dimUnit: 'cm', weight: weightNum, weightUnit: 'kg', service: 'regular', currency: 'CAD',
      });
      setQuote((q ?? null) as QuoteShape | null);
      setSendStep('review');
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      setErrText(e instanceof Error ? e.message : 'محاسبه‌ی قیمت ناموفق بود.');
    } finally {
      setBusy(false);
    }
  }, [canContinue, busy, parcelQuote, lengthCm, widthCm, heightCm, weightNum]);

  // ── SEND: review → pay + create label ──
  const payAndCreate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErrText('');
    try {
      // NOTE: sandbox payment settles instantly. When a real Stripe key is
      // wired in, this is the single place to insert the PaymentIntent step.
      const res = await parcelCreate.mutateAsync({
        fromName, fromLine1, fromCity, fromRegion, fromPostal, fromCountry: 'CA',
        toName, toLine1, toCity, toRegion, toPostal, toCountry: 'CA',
        length: num(lengthCm), width: num(widthCm), height: num(heightCm), dimUnit: 'cm',
        weight: weightNum, weightUnit: 'kg', service: 'regular', currency: 'CAD',
        notes: commodity ? `Contents: ${commodity}` : '',
      });
      const t = (res?.parcel as { tracking_number?: string } | null)?.tracking_number ?? '';
      setTracking(t);
      setSendStep('label');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setErrText(e instanceof Error ? e.message : 'ثبت بسته ناموفق بود.');
    } finally {
      setBusy(false);
    }
  }, [busy, parcelCreate, fromName, fromLine1, fromCity, fromRegion, fromPostal,
      toName, toLine1, toCity, toRegion, toPostal, lengthCm, widthCm, heightCm, weightNum, commodity]);

  // ── Printable label (expo-print) ──
  const printLabel = useCallback(async () => {
    try {
      const html = `<!doctype html><html><body style="font-family:-apple-system,Helvetica,Arial;padding:32px;">
        <h1 style="letter-spacing:2px;">Dock2Door</h1>
        <p style="font-size:14px;color:#555;">Shipping label</p>
        <hr/>
        <p><b>To:</b> ${toName || '-'}<br/>${toLine1 || ''} ${toCity || ''} ${toRegion || ''} ${toPostal || ''}</p>
        <p><b>From:</b> ${fromName || '-'}<br/>${fromLine1 || ''} ${fromCity || ''}</p>
        <p><b>Contents:</b> ${commodity || '-'}</p>
        <h2 style="letter-spacing:4px;text-align:center;margin-top:40px;">${tracking}</h2>
        <p style="text-align:center;color:#555;">Scan at drop-off</p>
      </body></html>`;
      await Print.printAsync({ html });
    } catch {
      // Printing cancelled or unavailable — no-op.
    }
  }, [toName, toLine1, toCity, toRegion, toPostal, fromName, fromLine1, fromCity, commodity, tracking]);

  // ── Drop-off: find nearest post office via live web search ──
  const findPostOffice = useCallback(async () => {
    if (poLoading) return;
    setPoLoading(true);
    try {
      const where = [fromLine1, fromCity, fromRegion, fromPostal].filter(Boolean).join(', ') || fromCity;
      const digest = await searchWeb(`nearest post office / Canada Post drop-off location to ${where} — name and full street address, open hours`);
      const line = digest.split('\n').find((l) => l.trim().startsWith('-')) ?? digest.slice(0, 240);
      const clean = line.replace(/^-\s*/, '').trim() || 'نزدیک‌ترین دفتر پست به آدرس شما — لطفاً روی نقشه‌ی گوشی جست‌وجو کنید.';
      setPostOffice(clean);
      onComplete(
        `📮 نزدیک‌ترین محل تحویل به آدرس شما:\n\n${clean}\n\nلیبل را چاپ کنید، روی بسته بچسبانید و همان‌جا تحویل دهید. بقیه با ماست.`,
      );
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setPostOffice('نتوانستیم دفتر پست را پیدا کنیم — دوباره تلاش کنید.');
    } finally {
      setPoLoading(false);
    }
  }, [poLoading, fromLine1, fromCity, fromRegion, fromPostal, onComplete]);

  // ── Pickup / Return: dispatch a driver via the loads marketplace ──
  const requestDriver = useCallback(async (isReturn: boolean) => {
    if (busy) return;
    setBusy(true);
    setErrText('');
    try {
      const address = [fromLine1, fromCity, fromRegion, fromPostal].filter(Boolean).join(', ');
      let lat = 0;
      let lng = 0;
      try {
        if (Platform.OS !== 'web' && address) {
          const geo = await Location.geocodeAsync(address);
          if (geo[0]) { lat = geo[0].latitude; lng = geo[0].longitude; }
        }
      } catch {
        // Geocoding best-effort; the driver still gets the written address.
      }
      const noteBase = isReturn
        ? `RETURN pickup (${platform}). ${returnMode === 'scan'
            ? 'Driver scans the return barcode on the parcel at pickup'
            : 'Customer has printed & affixed the return label'}, then drops it at the nearest post office.`
        : `Parcel pickup — collect from sender and drop at the nearest post office. Contents: ${commodity || 'parcel'}.`;
      const res = await postLoad.mutateAsync({
        pickupLat: lat, pickupLng: lng, pickupAddress: address, pickupCity: fromCity,
        dropoffLat: lat, dropoffLng: lng, dropoffAddress: 'Nearest post office', dropoffCity: fromCity,
        vehicleType: vehicleForWeight(weightNum || 3),
        pallets: 1, deliverySpeed: 'NextDay',
        cargoType: 'Box', itemCount: 1, weightKg: weightNum || 3,
        lengthCm: num(lengthCm), widthCm: num(widthCm), heightCm: num(heightCm),
        itemDescription: commodity || (isReturn ? `${platform} return` : 'Parcel'),
        recipientName: fromName, recipientPhone: fromPhone,
        distanceKm: 8, notes: noteBase, cargoClass: 'General',
      });
      if (isReturn) setReturnStep('done'); else setSendStep('label');
      onComplete(
        isReturn
          ? `🚗 راننده درخواست شد. یک راننده برای گرفتن مرجوعی ${platform} می‌آید${returnMode === 'scan' ? ' و بارکد را همان‌جا اسکن می‌کند' : ''}، بسته را می‌گیرد و به پست تحویل می‌دهد. می‌توانید راننده را روی نقشه‌ی زنده ببینید.`
          : `🚗 راننده درخواست شد. یک راننده بسته را از آدرس شما می‌گیرد و به نزدیک‌ترین دفتر پست تحویل می‌دهد. می‌توانید راننده را روی نقشه‌ی زنده دنبال کنید.`,
        { href: trackHref, label: 'دنبال کردن راننده روی نقشه' },
      );
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setErrText(e instanceof Error ? e.message : 'درخواست راننده ناموفق بود.');
    } finally {
      setBusy(false);
    }
  }, [busy, fromLine1, fromCity, fromRegion, fromPostal, fromName, fromPhone,
      platform, returnMode, commodity, weightNum, lengthCm, widthCm, heightCm, postLoad, onComplete, trackHref]);

  // ══════════════════════ RENDER ══════════════════════
  const isReturn = flow === 'return';

  // Terminal state for a completed return.
  if (isReturn && returnStep === 'done') {
    return (
      <View style={[styles.card, styles.cardDone]}>
        <View style={styles.headRow}>
          <CheckCircle2 size={18} color={C.green} />
          <Text style={styles.headTitle}>مرجوعی ثبت شد</Text>
        </View>
        <Text style={styles.doneSub}>راننده در راه است. جزئیات در پیام بالا آمد.</Text>
      </View>
    );
  }

  // SEND — label / routing step
  if (!isReturn && sendStep === 'label') {
    return (
      <View style={[styles.card, styles.cardDone]}>
        <View style={styles.headRow}>
          <CheckCircle2 size={18} color={C.green} />
          <Text style={styles.headTitle}>بسته ثبت شد — لیبل آماده است</Text>
        </View>
        {tracking ? (
          <View style={styles.labelBox}>
            <TrackingCode tracking={tracking} qrSize={104} />
          </View>
        ) : null}
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => void printLabel()}>
          <Printer size={15} color={C.accent} />
          <Text style={styles.secondaryText}>چاپ لیبل</Text>
        </TouchableOpacity>

        <View style={styles.divider} />
        {method === 'dropoff' ? (
          <>
            <Text style={styles.routeHint}>لیبل را روی بسته بچسبانید و به نزدیک‌ترین دفتر پست تحویل دهید.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => void findPostOffice()} disabled={poLoading}>
              {poLoading ? <ActivityIndicator size="small" color={C.white} /> : <Search size={15} color={C.white} />}
              <Text style={styles.primaryText}>پیدا کردن نزدیک‌ترین دفتر پست</Text>
            </TouchableOpacity>
            {postOffice ? <Text style={styles.poResult}>📮 {postOffice}</Text> : null}
          </>
        ) : (
          <>
            <Text style={styles.routeHint}>یک راننده بسته را از در خانه می‌گیرد و به پست می‌برد (هزینه‌ی pickup اضافه می‌شود).</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => void requestDriver(false)} disabled={busy}>
              {busy ? <ActivityIndicator size="small" color={C.white} /> : <Truck size={15} color={C.white} />}
              <Text style={styles.primaryText}>درخواست راننده برای pickup</Text>
            </TouchableOpacity>
          </>
        )}
        {errText ? <Text style={styles.err}>{errText}</Text> : null}
      </View>
    );
  }

  // SEND — review / pay step
  if (!isReturn && sendStep === 'review') {
    const price = quote?.price != null ? `${Number(quote.price).toFixed(2)} ${quote.currency ?? 'CAD'}` : '—';
    return (
      <View style={styles.card}>
        <View style={styles.headRow}>
          <CreditCard size={18} color={C.accent} />
          <Text style={styles.headTitle}>تأیید و پرداخت</Text>
        </View>
        <View style={styles.summaryRow}><Text style={styles.sumLabel}>مسیر</Text><Text style={styles.sumVal}>{fromCity} → {toCity}</Text></View>
        <View style={styles.summaryRow}><Text style={styles.sumLabel}>وزن قابل‌محاسبه</Text><Text style={styles.sumVal}>{quote?.chargeable_kg != null ? `${quote.chargeable_kg} kg` : `${weightNum} kg`}</Text></View>
        <View style={styles.summaryRow}><Text style={styles.sumLabel}>روش تحویل</Text><Text style={styles.sumVal}>{method === 'dropoff' ? 'تحویل حضوری' : 'راننده (pickup)'}</Text></View>
        <View style={[styles.summaryRow, styles.totalRow]}><Text style={styles.totalLabel}>مبلغ قابل پرداخت</Text><Text style={styles.totalVal}>{price}</Text></View>
        <Text style={styles.sandboxNote}>پرداخت آزمایشی (sandbox). با اتصال کلید واقعی Stripe فعال می‌شود.</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => void payAndCreate()} disabled={busy}>
          {busy ? <ActivityIndicator size="small" color={C.white} /> : <CheckCircle2 size={15} color={C.white} />}
          <Text style={styles.primaryText}>پرداخت و ساخت لیبل</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={() => setSendStep('form')} disabled={busy}>
          <Text style={styles.linkText}>بازگشت و ویرایش</Text>
        </TouchableOpacity>
        {errText ? <Text style={styles.err}>{errText}</Text> : null}
      </View>
    );
  }

  // FORM step (send + return share the sender + item blocks)
  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        {isReturn ? <RotateCcw size={18} color={C.accent} /> : <Package size={18} color={C.accent} />}
        <Text style={styles.headTitle}>{isReturn ? 'ثبت مرجوعی' : 'ثبت بسته برای ارسال'}</Text>
      </View>

      {/* Sender */}
      <View style={styles.sectionRow}><User size={13} color={C.textSecondary} /><Text style={styles.sectionTitle}>{isReturn ? 'آدرس شما (محل pickup)' : 'فرستنده'}</Text></View>
      <Input label="نام" value={fromName} onChangeText={setFromName} placeholder="نام کامل" />
      <Input label="تلفن" value={fromPhone} onChangeText={setFromPhone} placeholder="+1 ..." keyboardType="phone-pad" />
      <Input label="آدرس" value={fromLine1} onChangeText={setFromLine1} placeholder="خیابان و پلاک" />
      <View style={styles.grid2}>
        <Input containerStyle={styles.gridItem} label="شهر" value={fromCity} onChangeText={setFromCity} placeholder="شهر" />
        <Input containerStyle={styles.gridItem} label="استان" value={fromRegion} onChangeText={setFromRegion} placeholder="استان" />
      </View>
      <Input label="کد پستی" value={fromPostal} onChangeText={setFromPostal} placeholder="A1A 1A1" autoCapitalize="characters" />

      {!isReturn ? (
        <>
          {/* Recipient */}
          <View style={styles.sectionRow}><MapPin size={13} color={C.textSecondary} /><Text style={styles.sectionTitle}>گیرنده</Text></View>
          <Input label="نام" value={toName} onChangeText={setToName} placeholder="نام گیرنده" />
          <Input label="تلفن" value={toPhone} onChangeText={setToPhone} placeholder="+1 ..." keyboardType="phone-pad" />
          <Input label="آدرس" value={toLine1} onChangeText={setToLine1} placeholder="خیابان و پلاک" />
          <View style={styles.grid2}>
            <Input containerStyle={styles.gridItem} label="شهر" value={toCity} onChangeText={setToCity} placeholder="شهر" />
            <Input containerStyle={styles.gridItem} label="استان" value={toRegion} onChangeText={setToRegion} placeholder="استان" />
          </View>
          <Input label="کد پستی" value={toPostal} onChangeText={setToPostal} placeholder="A1A 1A1" autoCapitalize="characters" />
        </>
      ) : null}

      {/* Item */}
      <View style={styles.sectionRow}><Package size={13} color={C.textSecondary} /><Text style={styles.sectionTitle}>کالا</Text></View>
      <Input label={isReturn ? 'چه چیزی مرجوع می‌کنید؟' : 'چه چیزی می‌فرستید؟'} value={commodity} onChangeText={setCommodity} placeholder="مثلاً کفش، لباس، مبل" />

      {!isReturn ? (
        <>
          <View style={styles.sectionRow}><Scale size={13} color={C.textSecondary} /><Text style={styles.sectionTitle}>وزن و ابعاد</Text></View>
          <Input label="وزن (kg)" value={weight} onChangeText={setWeight} placeholder="مثلاً 2" keyboardType="numeric" />
          <View style={styles.grid3}>
            <Input containerStyle={styles.gridItem} label="طول" value={lengthCm} onChangeText={setLengthCm} placeholder="cm" keyboardType="numeric" />
            <Input containerStyle={styles.gridItem} label="عرض" value={widthCm} onChangeText={setWidthCm} placeholder="cm" keyboardType="numeric" />
            <Input containerStyle={styles.gridItem} label="ارتفاع" value={heightCm} onChangeText={setHeightCm} placeholder="cm" keyboardType="numeric" />
          </View>
          <View style={styles.sectionRow}><Calendar size={13} color={C.textSecondary} /><Text style={styles.sectionTitle}>تاریخ آمادگی</Text></View>
          <Input label="کِی حاضر است؟" value={readyDate} onChangeText={setReadyDate} placeholder="YYYY-MM-DD (اختیاری)" />

          {/* Delivery method */}
          <View style={styles.sectionRow}><Truck size={13} color={C.textSecondary} /><Text style={styles.sectionTitle}>روش تحویل</Text></View>
          <View style={styles.choiceRow}>
            <TouchableOpacity style={[styles.choice, method === 'dropoff' && styles.choiceActive]} onPress={() => setMethod('dropoff')}>
              <Store size={16} color={method === 'dropoff' ? C.accent : C.textMuted} />
              <Text style={[styles.choiceText, method === 'dropoff' && styles.choiceTextActive]}>تحویل حضوری به پست</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.choice, method === 'pickup' && styles.choiceActive]} onPress={() => setMethod('pickup')}>
              <Truck size={16} color={method === 'pickup' ? C.accent : C.textMuted} />
              <Text style={[styles.choiceText, method === 'pickup' && styles.choiceTextActive]}>راننده بیاید (pickup)</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          {/* Return platform + mode */}
          <View style={styles.sectionRow}><Store size={13} color={C.textSecondary} /><Text style={styles.sectionTitle}>پلتفرم</Text></View>
          <View style={styles.choiceRow}>
            {['Amazon', 'Temu', 'Shopify', 'دیگر'].map((p) => (
              <TouchableOpacity key={p} style={[styles.chip, platform === p && styles.chipActive]} onPress={() => setPlatform(p)}>
                <Text style={[styles.chipText, platform === p && styles.chipTextActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.sectionRow}><ScanLine size={13} color={C.textSecondary} /><Text style={styles.sectionTitle}>لیبل مرجوعی</Text></View>
          <View style={styles.choiceRow}>
            <TouchableOpacity style={[styles.choice, returnMode === 'scan' && styles.choiceActive]} onPress={() => setReturnMode('scan')}>
              <ScanLine size={16} color={returnMode === 'scan' ? C.accent : C.textMuted} />
              <Text style={[styles.choiceText, returnMode === 'scan' && styles.choiceTextActive]}>راننده بارکد را اسکن کند</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.choice, returnMode === 'printed' && styles.choiceActive]} onPress={() => setReturnMode('printed')}>
              <Printer size={16} color={returnMode === 'printed' ? C.accent : C.textMuted} />
              <Text style={[styles.choiceText, returnMode === 'printed' && styles.choiceTextActive]}>لیبل را چاپ کرده‌ام</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {missing.length > 0 ? (
        <Text style={styles.missing}>لطفاً تکمیل کنید: {missing.join('، ')}</Text>
      ) : null}

      <TouchableOpacity
        style={[styles.primaryBtn, (!canContinue || busy) && styles.btnDisabled]}
        disabled={!canContinue || busy}
        onPress={() => (isReturn ? void requestDriver(true) : void goReview())}
      >
        {busy ? <ActivityIndicator size="small" color={C.white} /> : <ChevronRight size={16} color={C.white} />}
        <Text style={styles.primaryText}>{isReturn ? 'درخواست راننده برای مرجوعی' : 'ادامه'}</Text>
      </TouchableOpacity>
      {errText ? <Text style={styles.err}>{errText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 8, marginLeft: 6, marginRight: 30,
    backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.accent + '44',
    borderRadius: 16, padding: 14, gap: 10,
  },
  cardDone: { backgroundColor: C.greenDim, borderColor: C.green + '55' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headTitle: { flex: 1, fontSize: 14.5, fontWeight: '800' as const, color: C.text },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  sectionTitle: { fontSize: 12.5, fontWeight: '700' as const, color: C.textSecondary },
  grid2: { flexDirection: 'row', gap: 8 },
  grid3: { flexDirection: 'row', gap: 8 },
  gridItem: { flex: 1 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    flex: 1, minWidth: 130, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10,
  },
  choiceActive: { borderColor: C.accent, backgroundColor: C.accent + '18' },
  choiceText: { flex: 1, fontSize: 12.5, fontWeight: '600' as const, color: C.textMuted },
  choiceTextActive: { color: C.text },
  chip: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 14 },
  chipActive: { borderColor: C.accent, backgroundColor: C.accent + '18' },
  chipText: { fontSize: 12.5, fontWeight: '600' as const, color: C.textMuted },
  chipTextActive: { color: C.text },
  missing: { fontSize: 12, color: C.yellow, lineHeight: 17 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.accent, borderRadius: 12, paddingVertical: 13, marginTop: 4,
  },
  primaryText: { color: C.white, fontSize: 14, fontWeight: '800' as const },
  btnDisabled: { opacity: 0.5 },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.accent + '18', borderWidth: 1, borderColor: C.accent + '55',
    borderRadius: 10, paddingVertical: 10,
  },
  secondaryText: { color: C.accent, fontSize: 13, fontWeight: '700' as const },
  linkBtn: { alignItems: 'center', paddingVertical: 4 },
  linkText: { color: C.textSecondary, fontSize: 12.5, fontWeight: '600' as const },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sumLabel: { fontSize: 13, color: C.textSecondary },
  sumVal: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  totalRow: { marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  totalLabel: { fontSize: 14, fontWeight: '800' as const, color: C.text },
  totalVal: { fontSize: 16, fontWeight: '900' as const, color: C.accent },
  sandboxNote: { fontSize: 11.5, color: C.textMuted, lineHeight: 16 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 4 },
  labelBox: { backgroundColor: C.white, borderRadius: 12, padding: 12, alignItems: 'center' },
  routeHint: { fontSize: 12.5, color: C.textSecondary, lineHeight: 18 },
  poResult: { fontSize: 12.5, color: C.text, lineHeight: 18, backgroundColor: C.card, borderRadius: 10, padding: 10 },
  doneSub: { fontSize: 12.5, color: C.textSecondary, lineHeight: 18 },
  err: { fontSize: 12, color: C.red, lineHeight: 17 },
});
