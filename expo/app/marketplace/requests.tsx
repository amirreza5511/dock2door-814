import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { ArrowLeft, Inbox, Send, MapPin, Clock, DollarSign, Building2, ChevronRight } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import { subcategoryLabel } from '@/constants/serviceMarketplace';
import type { ServiceJob, ServiceListing, Company } from '@/constants/types';

type Tab = 'incoming' | 'sent';

const STATUS_COLOR: Record<string, string> = {
  Requested: C.yellow,
  Accepted: C.blue,
  Scheduled: C.blue,
  InProgress: C.accent,
  Completed: C.green,
  Cancelled: C.textMuted,
};

const QUOTE_LABEL: Record<string, string> = {
  requested: 'Quote requested',
  quoted: 'Quote sent',
  accepted: 'Quote accepted',
  declined: 'Quote declined',
};

export default function MarketplaceRequests() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const bootstrapQuery = useDockBootstrapData();
  const { serviceListings, serviceJobs, companies } = bootstrapQuery.data;
  const [tab, setTab] = useState<Tab>('incoming');

  const listingById = useMemo(() => {
    const m = new Map<string, ServiceListing>();
    serviceListings.forEach((l) => m.set(l.id, l));
    return m;
  }, [serviceListings]);

  const companyById = useMemo(() => {
    const m = new Map<string, Company>();
    companies.forEach((c) => m.set(c.id, c));
    return m;
  }, [companies]);

  const myListingIds = useMemo(
    () => new Set(serviceListings.filter((l) => l.companyId === user?.companyId).map((l) => l.id)),
    [serviceListings, user],
  );

  const incoming = useMemo(
    () => serviceJobs.filter((j) => myListingIds.has(j.serviceId)),
    [serviceJobs, myListingIds],
  );
  const sent = useMemo(
    () => serviceJobs.filter((j) => j.customerCompanyId === user?.companyId),
    [serviceJobs, user],
  );

  const rows = tab === 'incoming' ? incoming : sent;

  const titleFor = (job: ServiceJob): string => {
    const l = listingById.get(job.serviceId);
    return l?.title || subcategoryLabel(l?.subcategory) || 'Marketplace request';
  };

  const counterpartyFor = (job: ServiceJob): string => {
    if (tab === 'incoming') {
      return companyById.get(job.customerCompanyId)?.name ?? 'Requesting company';
    }
    const l = listingById.get(job.serviceId);
    return l ? (companyById.get(l.companyId)?.name ?? 'Provider') : 'Provider';
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Requests</Text>
          <Text style={styles.headerSub}>Marketplace bookings for your company</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity onPress={() => setTab('incoming')} style={[styles.tab, tab === 'incoming' && styles.tabActive]}>
          <Inbox size={15} color={tab === 'incoming' ? C.accent : C.textSecondary} />
          <Text style={[styles.tabText, tab === 'incoming' && styles.tabTextActive]}>Incoming ({incoming.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('sent')} style={[styles.tab, tab === 'sent' && styles.tabActive]}>
          <Send size={15} color={tab === 'sent' ? C.accent : C.textSecondary} />
          <Text style={[styles.tabText, tab === 'sent' && styles.tabTextActive]}>Sent ({sent.length})</Text>
        </TouchableOpacity>
      </View>

      {bootstrapQuery.isLoading ? (
        <View style={styles.centerFill}><ScreenFeedback state="loading" title="Loading requests" /></View>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
          {rows.map((job) => (
            <TouchableOpacity
              key={job.id}
              style={styles.card}
              activeOpacity={0.85}
              onPress={() => router.push({ pathname: '/marketplace/order/[id]', params: { id: job.id } } as never)}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle} numberOfLines={1}>{titleFor(job)}</Text>
                <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLOR[job.status] ?? C.textMuted) + '22' }]}>
                  <Text style={[styles.statusText, { color: STATUS_COLOR[job.status] ?? C.textMuted }]}>{job.status}</Text>
                </View>
              </View>
              {job.quoteStatus && job.quoteStatus !== 'none' && QUOTE_LABEL[job.quoteStatus] ? (
                <View style={styles.quotePill}>
                  <Text style={styles.quotePillText}>{QUOTE_LABEL[job.quoteStatus]}{job.quotedAmount ? ` · $${job.quotedAmount.toLocaleString()}` : ''}</Text>
                </View>
              ) : null}
              <View style={styles.metaRow}>
                <Building2 size={12} color={C.textMuted} />
                <Text style={styles.metaText}>{counterpartyFor(job)}</Text>
              </View>
              {(job.locationCity || job.locationAddress) ? (
                <View style={styles.metaRow}>
                  <MapPin size={12} color={C.textMuted} />
                  <Text style={styles.metaText}>{[job.locationAddress, job.locationCity].filter(Boolean).join(', ')}</Text>
                </View>
              ) : null}
              <View style={styles.footerRow}>
                <View style={styles.metaRow}>
                  <Clock size={12} color={C.textMuted} />
                  <Text style={styles.metaText}>{job.durationHours}h</Text>
                </View>
                {job.totalPrice > 0 && (
                  <View style={styles.metaRow}>
                    <DollarSign size={13} color={C.green} />
                    <Text style={styles.priceText}>${job.totalPrice}</Text>
                  </View>
                )}
                <ChevronRight size={16} color={C.textMuted} />
              </View>
            </TouchableOpacity>
          ))}
          {rows.length === 0 && (
            <View style={styles.emptyState}>
              {tab === 'incoming' ? <Inbox size={40} color={C.textMuted} /> : <Send size={40} color={C.textMuted} />}
              <Text style={styles.emptyText}>{tab === 'incoming' ? 'No incoming requests' : 'No requests sent'}</Text>
              <Text style={styles.emptySub}>
                {tab === 'incoming'
                  ? 'When another company requests one of your listings, it shows up here.'
                  : 'Browse the marketplace and request equipment or a service to see it here.'}
              </Text>
              {tab === 'sent' && (
                <TouchableOpacity onPress={() => router.push('/marketplace/browse' as never)} style={styles.emptyBtn}>
                  <Text style={styles.emptyBtnText}>Browse marketplace</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  tabActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  tabText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  tabTextActive: { color: C.accent, fontWeight: '700' as const },
  centerFill: { flex: 1, justifyContent: 'center', padding: 20 },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text, flex: 1 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: '700' as const },
  quotePill: { alignSelf: 'flex-start', backgroundColor: C.yellowDim, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 6 },
  quotePillText: { fontSize: 11, color: C.yellow, fontWeight: '700' as const },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  metaText: { fontSize: 12, color: C.textSecondary, flex: 1 },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, marginTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  priceText: { fontSize: 15, fontWeight: '800' as const, color: C.green },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyText: { fontSize: 16, color: C.textSecondary, fontWeight: '700' as const },
  emptySub: { fontSize: 13, color: C.textMuted, textAlign: 'center', paddingHorizontal: 40 },
  emptyBtn: { backgroundColor: C.accent, paddingHorizontal: 16, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  emptyBtnText: { color: C.white, fontWeight: '700' as const, fontSize: 13 },
});
