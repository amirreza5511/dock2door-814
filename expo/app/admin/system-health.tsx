import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Activity, CheckCircle2, XCircle, PlayCircle, AlertTriangle, Clock } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import ResponsiveContainer from '@/components/ui/ResponsiveContainer';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

type CheckStatus = 'idle' | 'running' | 'pass' | 'fail' | 'warn';

interface CheckResult {
  id: string;
  name: string;
  affects: string;
  status: CheckStatus;
  message?: string;
  durationMs?: number;
}

const INITIAL_CHECKS: Omit<CheckResult, 'status'>[] = [
  { id: 'role', name: 'Current user role / admin access', affects: 'All admin screens & admin RPCs' },
  { id: 'rpc', name: 'Supabase RPCs callable (my_companies)', affects: 'Active company switching, all role panels' },
  { id: 'pending', name: 'Pending companies visible (admin RLS)', affects: 'Admin > Companies, company approval workflow' },
  { id: 'storage', name: 'Storage signed URL (get-signed-url)', affects: 'Cert previews, booking docs, invoices, attachments' },
  { id: 'checkout', name: 'Stripe checkout function reachable', affects: 'Customer pay invoice (FinanceScreen)' },
  { id: 'connectOnboard', name: 'Stripe Connect onboard function reachable', affects: 'Warehouse/Service provider payouts' },
  { id: 'connectDashboard', name: 'Stripe Connect dashboard function reachable', affects: 'Provider Stripe Express dashboard' },
  { id: 'easypost', name: 'EasyPost label function reachable', affects: 'Shipment label purchase (fulfillment)' },
  { id: 'push', name: 'Push notification dispatcher reachable', affects: 'Chat push, booking status push, alerts' },
  { id: 'realtime', name: 'Realtime messaging connection', affects: 'Live chat / thread messages' },
  { id: 'edge', name: 'Edge Functions base reachable', affects: 'All Edge Function-backed workflows' },
];

interface InvokeProbe {
  ok: boolean;
  reachable: boolean;
  status?: number;
  message: string;
}

async function probeFunction(name: string, body: Record<string, unknown>): Promise<InvokeProbe> {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
      const ctx = (error as unknown as { context?: { status?: number } }).context;
      const status = ctx?.status;
      if (typeof status === 'number') {
        const reachable = status !== 0;
        const ok = status >= 200 && status < 300;
        return { ok, reachable, status, message: `${status} ${error.message ?? ''}`.trim() };
      }
      const msg = error.message ?? String(error);
      const looksUnreachable = /not\s*found|failed to fetch|network|fetch error|deploy/i.test(msg);
      return { ok: false, reachable: !looksUnreachable, message: msg };
    }
    return { ok: true, reachable: true, status: 200, message: typeof data === 'object' ? 'OK' : String(data ?? 'OK') };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reachable: false, message: msg };
  }
}

export default function SystemHealthScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const [results, setResults] = useState<CheckResult[]>(
    INITIAL_CHECKS.map((c) => ({ ...c, status: 'idle' as CheckStatus })),
  );
  const [running, setRunning] = useState<boolean>(false);
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);

  const update = useCallback((id: string, patch: Partial<CheckResult>) => {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const runOne = useCallback(async (id: string): Promise<void> => {
    const start = Date.now();
    update(id, { status: 'running', message: undefined, durationMs: undefined });
    try {
      switch (id) {
        case 'role': {
          const { data: sessionData } = await supabase.auth.getSession();
          if (!sessionData.session) {
            update(id, { status: 'fail', message: 'No active session.' });
            break;
          }
          const { data: roleRow, error: roleErr } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', sessionData.session.user.id)
            .eq('role', 'admin')
            .maybeSingle();
          if (roleErr) {
            update(id, { status: 'fail', message: `user_roles read failed: ${roleErr.message}` });
            break;
          }
          if (!roleRow) {
            update(id, { status: 'warn', message: `Signed in as ${user?.email ?? sessionData.session.user.email} but no admin row in user_roles.` });
            break;
          }
          update(id, { status: 'pass', message: `Admin confirmed for ${user?.email ?? sessionData.session.user.email}` });
          break;
        }
        case 'rpc': {
          const { data, error } = await supabase.rpc('my_companies');
          if (error) {
            update(id, { status: 'fail', message: `my_companies RPC failed: ${error.message}` });
            break;
          }
          const count = Array.isArray(data) ? data.length : 0;
          update(id, { status: 'pass', message: `RPC OK. ${count} membership row(s).` });
          break;
        }
        case 'pending': {
          const { data, error, count } = await supabase
            .from('companies')
            .select('id,name,status', { count: 'exact' })
            .eq('status', 'PendingApproval')
            .limit(5);
          if (error) {
            update(id, { status: 'fail', message: `companies SELECT blocked: ${error.message}` });
            break;
          }
          const n = count ?? data?.length ?? 0;
          update(id, {
            status: 'pass',
            message: n === 0 ? 'Query OK. No pending companies right now.' : `Visible: ${n} pending compan${n === 1 ? 'y' : 'ies'}.`,
          });
          break;
        }
        case 'storage': {
          const probe = await probeFunction('get-signed-url', { bucket: 'attachments', path: '__healthcheck__/none.txt' });
          if (!probe.reachable) {
            update(id, { status: 'fail', message: `Function not reachable: ${probe.message}` });
            break;
          }
          if (probe.status === 401 || probe.status === 403) {
            update(id, { status: 'warn', message: `Reachable but auth/RLS rejected (${probe.status}). Expected for missing object. ${probe.message}` });
            break;
          }
          if (probe.status === 404 || probe.status === 400) {
            update(id, { status: 'pass', message: `Reachable. Returned ${probe.status} for missing object (expected).` });
            break;
          }
          update(id, { status: probe.ok ? 'pass' : 'warn', message: probe.message });
          break;
        }
        case 'checkout': {
          const probe = await probeFunction('create-checkout-session', { invoice_id: '00000000-0000-0000-0000-000000000000' });
          if (!probe.reachable) {
            update(id, { status: 'fail', message: `Function not reachable: ${probe.message}` });
            break;
          }
          if (probe.status === 400 || probe.status === 404 || probe.status === 403) {
            update(id, { status: 'pass', message: `Reachable. Rejected dummy invoice with ${probe.status} (expected).` });
            break;
          }
          update(id, { status: probe.ok ? 'pass' : 'warn', message: `${probe.status ?? '?'} ${probe.message}` });
          break;
        }
        case 'connectOnboard': {
          const probe = await probeFunction('stripe-connect-onboard', { company_id: '00000000-0000-0000-0000-000000000000' });
          if (!probe.reachable) {
            update(id, { status: 'fail', message: `Function not reachable: ${probe.message}` });
            break;
          }
          if (probe.status && probe.status >= 400 && probe.status < 500) {
            update(id, { status: 'pass', message: `Reachable. ${probe.status} for dummy company (expected).` });
            break;
          }
          update(id, { status: probe.ok ? 'pass' : 'warn', message: `${probe.status ?? '?'} ${probe.message}` });
          break;
        }
        case 'connectDashboard': {
          const probe = await probeFunction('stripe-connect-dashboard', { company_id: '00000000-0000-0000-0000-000000000000' });
          if (!probe.reachable) {
            update(id, { status: 'fail', message: `Function not reachable: ${probe.message}` });
            break;
          }
          if (probe.status && probe.status >= 400 && probe.status < 500) {
            update(id, { status: 'pass', message: `Reachable. ${probe.status} for dummy company (expected).` });
            break;
          }
          update(id, { status: probe.ok ? 'pass' : 'warn', message: `${probe.status ?? '?'} ${probe.message}` });
          break;
        }
        case 'easypost': {
          const probe = await probeFunction('purchase-shipping-label', { shipment_id: '00000000-0000-0000-0000-000000000000' });
          if (!probe.reachable) {
            update(id, { status: 'fail', message: `Function not reachable: ${probe.message}` });
            break;
          }
          if (probe.status && probe.status >= 400 && probe.status < 500) {
            update(id, { status: 'pass', message: `Reachable. ${probe.status} for dummy shipment (expected). Verify EASYPOST_API_KEY secret.` });
            break;
          }
          update(id, { status: probe.ok ? 'pass' : 'warn', message: `${probe.status ?? '?'} ${probe.message}` });
          break;
        }
        case 'push': {
          const probe = await probeFunction('push-notifications', { batch: true, limit: 0 });
          if (!probe.reachable) {
            update(id, { status: 'fail', message: `Function not reachable: ${probe.message}` });
            break;
          }
          update(id, { status: probe.ok ? 'pass' : 'warn', message: probe.ok ? `Dispatcher reachable. ${probe.message}` : `${probe.status ?? '?'} ${probe.message}` });
          break;
        }
        case 'realtime': {
          const ok: boolean = await new Promise((resolve) => {
            let settled = false;
            const channel = supabase.channel(`health-${Date.now()}`);
            const finish = (v: boolean) => {
              if (settled) return;
              settled = true;
              try { void supabase.removeChannel(channel); } catch {}
              resolve(v);
            };
            const t = setTimeout(() => finish(false), 6000);
            channel.subscribe((status) => {
              console.log('[health] realtime status', status);
              if (status === 'SUBSCRIBED') { clearTimeout(t); finish(true); }
              if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                clearTimeout(t); finish(false);
              }
            });
          });
          update(id, { status: ok ? 'pass' : 'fail', message: ok ? 'Realtime SUBSCRIBED.' : 'Realtime did not subscribe within 6s.' });
          break;
        }
        case 'edge': {
          const base = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
          if (!base) {
            update(id, { status: 'fail', message: 'EXPO_PUBLIC_SUPABASE_URL not set.' });
            break;
          }
          try {
            const res = await fetch(`${base.replace(/\/$/, '')}/functions/v1/__health__`, { method: 'GET' });
            update(id, {
              status: res.status === 404 || (res.status >= 200 && res.status < 500) ? 'pass' : 'warn',
              message: `Functions gateway responded with ${res.status} (any non-network status = reachable).`,
            });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            update(id, { status: 'fail', message: `Functions gateway unreachable: ${msg}` });
          }
          break;
        }
        default:
          update(id, { status: 'warn', message: 'Unknown check.' });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      update(id, { status: 'fail', message: msg });
    } finally {
      update(id, { durationMs: Date.now() - start });
    }
  }, [update, user?.email]);

  const runAll = useCallback(async () => {
    setRunning(true);
    setResults((prev) => prev.map((r) => ({ ...r, status: 'idle' as CheckStatus, message: undefined, durationMs: undefined })));
    for (const c of INITIAL_CHECKS) {
      // sequential to keep output readable
      // eslint-disable-next-line no-await-in-loop
      await runOne(c.id);
    }
    setLastRunAt(new Date());
    setRunning(false);
  }, [runOne]);

  const summary = useMemo(() => {
    const pass = results.filter((r) => r.status === 'pass').length;
    const fail = results.filter((r) => r.status === 'fail').length;
    const warn = results.filter((r) => r.status === 'warn').length;
    const idle = results.filter((r) => r.status === 'idle').length;
    return { pass, fail, warn, idle, total: results.length };
  }, [results]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Activity size={22} color={C.accent} />
          <Text style={styles.title}>System Health</Text>
        </View>
        <Text style={styles.subtitle}>Diagnose Edge Functions, RPCs, RLS, storage, realtime, push.</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        refreshControl={<RefreshControl refreshing={running} onRefresh={runAll} tintColor={C.accent} />}
      >
        <ResponsiveContainer>
          <Card style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <SummaryPill label="Pass" value={summary.pass} color={C.green} />
              <SummaryPill label="Warn" value={summary.warn} color={C.yellow} />
              <SummaryPill label="Fail" value={summary.fail} color={C.red} />
              <SummaryPill label="Idle" value={summary.idle} color={C.textMuted} />
            </View>
            <Text style={styles.lastRun}>
              {lastRunAt ? `Last run: ${lastRunAt.toLocaleTimeString()}` : 'Not run yet.'}
            </Text>
            <Button
              title={running ? 'Running checks…' : 'Run all checks'}
              onPress={runAll}
              disabled={running}
              testID="run-all-checks"
            />
          </Card>

          {results.map((r) => (
            <CheckRow key={r.id} result={r} onRun={() => runOne(r.id)} disabled={running} />
          ))}

          <Text style={styles.footnote}>
            Tip: a 4xx response from Stripe / EasyPost / checkout for a dummy ID is expected and proves the function is deployed and reachable. Only network / 5xx / not-found errors mean the function is broken.
          </Text>
        </ResponsiveContainer>
      </ScrollView>
    </View>
  );
}

function SummaryPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.pill, { borderColor: color }]} testID={`summary-${label.toLowerCase()}`}>
      <Text style={[styles.pillValue, { color }]}>{value}</Text>
      <Text style={styles.pillLabel}>{label}</Text>
    </View>
  );
}

function CheckRow({ result, onRun, disabled }: { result: CheckResult; onRun: () => void; disabled: boolean }) {
  const { icon, color, label } = statusVisual(result.status);
  return (
    <Card style={styles.row}>
      <View style={styles.rowHeader}>
        <View style={styles.rowTitleWrap}>
          {icon}
          <Text style={styles.rowTitle} numberOfLines={2}>{result.name}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: `${color}22`, borderColor: color }]}>
          <Text style={[styles.statusBadgeText, { color }]}>{label}</Text>
        </View>
      </View>
      <Text style={styles.affects}>Affects: {result.affects}</Text>
      {result.message ? (
        <Text style={[styles.message, { color: result.status === 'fail' ? C.red : result.status === 'warn' ? C.yellow : C.textSecondary }]} selectable>
          {result.message}
        </Text>
      ) : null}
      <View style={styles.rowFooter}>
        <Text style={styles.duration}>{result.durationMs ? `${result.durationMs} ms` : ' '}</Text>
        <TouchableOpacity
          onPress={onRun}
          disabled={disabled || result.status === 'running'}
          style={[styles.runBtn, (disabled || result.status === 'running') && { opacity: 0.5 }]}
          testID={`run-${result.id}`}
        >
          {result.status === 'running' ? <ActivityIndicator size="small" color={C.accent} /> : <PlayCircle size={16} color={C.accent} />}
          <Text style={styles.runBtnText}>{result.status === 'running' ? 'Running' : 'Run'}</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
}

function statusVisual(status: CheckStatus): { icon: React.ReactNode; color: string; label: string } {
  switch (status) {
    case 'pass':
      return { icon: <CheckCircle2 size={18} color={C.green} />, color: C.green, label: 'PASS' };
    case 'fail':
      return { icon: <XCircle size={18} color={C.red} />, color: C.red, label: 'FAIL' };
    case 'warn':
      return { icon: <AlertTriangle size={18} color={C.yellow} />, color: C.yellow, label: 'WARN' };
    case 'running':
      return { icon: <ActivityIndicator size="small" color={C.accent} />, color: C.accent, label: 'RUN' };
    default:
      return { icon: <Clock size={18} color={C.textMuted} />, color: C.textMuted, label: 'IDLE' };
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgSecondary },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: C.text, fontSize: 22, fontWeight: '700' as const },
  subtitle: { color: C.textSecondary, fontSize: 13, marginTop: 4 },
  summaryCard: { marginTop: 12, padding: 16, gap: 12 },
  summaryRow: { flexDirection: 'row', gap: 8 },
  pill: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center', backgroundColor: C.card },
  pillValue: { fontSize: 20, fontWeight: '800' as const },
  pillLabel: { color: C.textSecondary, fontSize: 11, marginTop: 2, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  lastRun: { color: C.textMuted, fontSize: 12 },
  row: { marginTop: 10, padding: 14, gap: 8 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  rowTitle: { color: C.text, fontSize: 15, fontWeight: '600' as const, flex: 1 },
  statusBadge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.5 },
  affects: { color: C.textMuted, fontSize: 12 },
  message: { fontSize: 12, fontFamily: undefined, marginTop: 2 },
  rowFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  duration: { color: C.textMuted, fontSize: 11 },
  runBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  runBtnText: { color: C.accent, fontSize: 13, fontWeight: '600' as const },
  footnote: { color: C.textMuted, fontSize: 11, marginTop: 16, marginBottom: 8, lineHeight: 16 },
});
