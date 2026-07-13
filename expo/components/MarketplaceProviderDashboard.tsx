import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Plus, DollarSign, Clock, CheckCircle, LogOut, Tag, Receipt, Inbox,
  Store, ChevronRight, UserCircle, type LucideIcon,
} from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import CompanySwitcher from '@/components/ui/CompanySwitcher';
import SupportMenu from '@/components/SupportMenu';
import StatusBadge from '@/components/ui/StatusBadge';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import ResponsiveContainer from '@/components/ui/ResponsiveContainer';
import { serviceTypeLabel, subcategoryLabel, type ServiceType } from '@/constants/serviceMarketplace';

export interface ProviderDashboardConfig {
  /** Header eyebrow, e.g. "Equipment Rental". */
  kicker: string;
  /** One-line description under the greeting block. */
  tagline: string;
  /** Primary service type this provider posts (used for default create + framing). */
  primaryType: ServiceType;
  icon: LucideIcon;
  accent: string;
  /** Verb for the incoming work, e.g. "rental request", "repair job", "policy request". */
  jobNoun: string;
}

/**
 * Full provider dashboard shared by every Domain 5 provider role (equipment/crane
 * rental, mobile repair, cargo insurer). Reads the same marketplace tables and
 * routes into the shared marketplace flow (listings, quotes, invoicing, profile).
 */
export default function MarketplaceProviderDashboard({ config }: { config: ProviderDashboardConfig }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const bootstrapQuery = useDockBootstrapData();
  const { serviceListings, serviceJobs, companies } = bootstrapQuery.data;

  const company = useMemo(() => companies.find((c) => c.id === user?.companyId), [companies, user]);
  const myListings = useMemo(
    () => serviceListings.filter((l) => l.companyId === user?.companyId),
    [serviceListings, user],
  );
  const myListingIds = useMemo(() => new Set(myListings.map((l) => l.id)), [myListings]);
  const myJobs = useMemo(
    () => serviceJobs
      .filter((j) => myListingIds.has(j.serviceId) || j.providerCompanyId === user?.companyId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [serviceJobs, myListingIds, user],
  );

  const stats = useMemo(() => {
    const active = myListings.filter((l) => l.status === 'Active' || l.status === 'Available').length;
    const pending = myJobs.filter((j) => j.status === 'Requested' || j.quoteStatus === 'requested').length;
    const completed = myJobs.filter((j) => j.status === 'Completed').length;
    const revenue = myJobs
      .filter((j) => j.status === 'Completed')
      .reduce((sum, j) => sum + Math.max(0, (j.totalPrice ?? 0) - (j.commissionAmount ?? 0)), 0);
    return { active, pending, completed, revenue };
  }, [myListings, myJobs]);

  const getCustomerName = (cid: string) => companies.find((c) => c.id === cid)?.name ?? 'Customer';

  if (bootstrapQuery.isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="loading" title={`Loading ${config.kicker.toLowerCase()} dashboard`} />
      </View>
    );
  }

  if (bootstrapQuery.isError) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="error" title="Unable to load dashboard" onRetry={() => void bootstrapQuery.refetch()} />
      </View>
    );
  }

  const Icon = config.icon;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={{ flex: 1 }}>
          <View style={styles.kickerRow}>
            <View style={[styles.kickerBadge, { backgroundColor: config.accent + '22' }]}>
              <Icon size={14} color={config.accent} />
            </View>
            <Text style={[styles.greeting, { color: config.accent }]}>{config.kicker}</Text>
          </View>
          <Text style={styles.name}>{user?.name}</Text>
          {company ? <Text style={styles.company}>{company.name}</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <CompanySwitcher />
          <SupportMenu />
          <TouchableOpacity onPress={logout} style={styles.logoutBtn}><LogOut size={18} color={C.textMuted} /></TouchableOpacity>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <ResponsiveContainer padded={false}>
          <View style={styles.statsGrid}>
            {[
              { label: 'Active Listings', value: stats.active, icon: Tag, color: config.accent },
              { label: `Pending ${config.jobNoun}s`, value: stats.pending, icon: Clock, color: C.yellow, hl: stats.pending > 0 },
              { label: 'Completed', value: stats.completed, icon: CheckCircle, color: C.green },
              { label: 'Net Revenue', value: `$${stats.revenue.toLocaleString()}`, icon: DollarSign, color: C.accent },
            ].map((s) => (
              <View key={s.label} style={[styles.statCard, s.hl && styles.statCardHighlight]}>
                <View style={[styles.statIconWrap, { backgroundColor: s.color + '20' }]}>
                  <s.icon size={18} color={s.color} />
                </View>
                <Text style={styles.statValue}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>

          {stats.pending > 0 ? (
            <TouchableOpacity onPress={() => router.push('/marketplace/requests' as never)} style={styles.alertBanner}>
              <Clock size={16} color={C.yellow} />
              <Text style={styles.alertText}>{stats.pending} {config.jobNoun}(s) awaiting your quote — tap to respond</Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.section}>
            <View style={styles.quickRow}>
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/marketplace/create', params: { type: config.primaryType } } as never)}
                style={[styles.quickCard, { backgroundColor: config.accent + '15', borderColor: config.accent + '40' }]}
                activeOpacity={0.85}
              >
                <Plus size={20} color={config.accent} />
                <Text style={styles.quickTitle}>New listing</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => user?.companyId && router.push(`/marketplace/provider/${user.companyId}` as never)}
                style={styles.quickCard}
                activeOpacity={0.85}
              >
                <UserCircle size={20} color={C.text} />
                <Text style={styles.quickTitle}>My profile</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.section}>
            <Card onPress={() => router.push('/marketplace/requests' as never)} style={styles.navCard}>
              <View style={styles.navRow}>
                <View style={[styles.catBadge, { backgroundColor: C.blueDim }]}><Inbox size={16} color={C.blue} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.navCat}>Requests & Quotes</Text>
                  <Text style={styles.navDetail}>Respond to {config.jobNoun}s, send quotes & schedule</Text>
                </View>
                <ChevronRight size={18} color={C.textMuted} />
              </View>
            </Card>
            <Card onPress={() => router.push('/marketplace/my-listings' as never)} style={[styles.navCard, { marginTop: 10 }]}>
              <View style={styles.navRow}>
                <View style={[styles.catBadge, { backgroundColor: config.accent + '20' }]}><Tag size={16} color={config.accent} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.navCat}>My Listings</Text>
                  <Text style={styles.navDetail}>{myListings.length} published · edit pricing & availability</Text>
                </View>
                <ChevronRight size={18} color={C.textMuted} />
              </View>
            </Card>
            <Card onPress={() => router.push('/marketplace/browse' as never)} style={[styles.navCard, { marginTop: 10 }]}>
              <View style={styles.navRow}>
                <View style={[styles.catBadge, { backgroundColor: C.accentDim }]}><Store size={16} color={C.accent} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.navCat}>Browse Marketplace</Text>
                  <Text style={styles.navDetail}>See what others rent, repair & insure</Text>
                </View>
                <ChevronRight size={18} color={C.textMuted} />
              </View>
            </Card>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Recent {config.jobNoun}s</Text>
              <TouchableOpacity onPress={() => router.push('/marketplace/requests' as never)}><Text style={styles.seeAll}>See All</Text></TouchableOpacity>
            </View>
            {myJobs.length === 0 ? (
              <Card><Text style={styles.emptyText}>No {config.jobNoun}s yet. Publish a listing to start receiving requests.</Text></Card>
            ) : myJobs.slice(0, 5).map((j) => (
              <Card key={j.id} style={styles.jobCard} onPress={() => router.push(`/marketplace/order/${j.id}` as never)}>
                <View style={styles.jobRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.jobCustomer}>{getCustomerName(j.customerCompanyId)}</Text>
                    <Text style={styles.jobMeta}>{j.locationCity || '—'} · {j.dateTimeStart?.split('T')[0] ?? ''}</Text>
                  </View>
                  <StatusBadge status={j.status} />
                </View>
                <View style={styles.jobFooter}>
                  <Text style={styles.jobPrice}>{j.quotedAmount != null ? `$${j.quotedAmount}` : j.totalPrice ? `$${j.totalPrice}` : 'Quote pending'}</Text>
                  <StatusBadge status={j.paymentStatus} />
                </View>
              </Card>
            ))}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>My Listings</Text>
              <TouchableOpacity onPress={() => router.push('/marketplace/my-listings' as never)}><Text style={styles.seeAll}>Manage</Text></TouchableOpacity>
            </View>
            {myListings.length === 0 ? (
              <Card style={styles.emptyListingCard} onPress={() => router.push({ pathname: '/marketplace/create', params: { type: config.primaryType } } as never)}>
                <Plus size={18} color={config.accent} />
                <Text style={[styles.emptyText, { marginTop: 6 }]}>Post your first {config.kicker.toLowerCase()} listing</Text>
              </Card>
            ) : myListings.map((l) => (
              <Card key={l.id} style={styles.listingCard}>
                <View style={styles.listingRow}>
                  <View style={[styles.catBadge, { backgroundColor: config.accent + '20' }]}>
                    <Receipt size={14} color={config.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.navCat}>{l.title || subcategoryLabel(l.subcategory) || serviceTypeLabel(l.serviceType)}</Text>
                    <Text style={styles.navDetail}>{serviceTypeLabel(l.serviceType)}{l.hourlyRate ? ` · $${l.hourlyRate}/hr` : ''}</Text>
                  </View>
                  <StatusBadge status={l.status} />
                </View>
              </Card>
            ))}
          </View>
        </ResponsiveContainer>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgSecondary },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  kickerBadge: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  greeting: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 0.4, textTransform: 'uppercase' as const },
  name: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3 },
  company: { fontSize: 13, color: C.accent, fontWeight: '600' as const, marginTop: 2 },
  logoutBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingTop: 20 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 20, marginBottom: 16 },
  statCard: { flex: 1, minWidth: '45%', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 4 },
  statCardHighlight: { borderColor: C.yellow + '60', backgroundColor: C.yellowDim },
  statIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 11, color: C.textSecondary },
  alertBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginBottom: 16, backgroundColor: C.yellowDim, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.yellow + '40' },
  alertText: { flex: 1, fontSize: 13, color: C.yellow },
  section: { paddingHorizontal: 20, marginBottom: 24 },
  quickRow: { flexDirection: 'row', gap: 10 },
  quickCard: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingVertical: 16 },
  quickTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  navCard: { marginBottom: 0 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  navCat: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  navDetail: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  seeAll: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  jobCard: { marginBottom: 8 },
  jobRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  jobCustomer: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  jobMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  jobFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  jobPrice: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  listingCard: { marginBottom: 8 },
  listingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  catBadge: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: 'center' },
  emptyListingCard: { alignItems: 'center', paddingVertical: 20 },
});
