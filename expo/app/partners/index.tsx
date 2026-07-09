import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, Alert, Platform, RefreshControl,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, Search, Building2, Star, MapPin, Handshake, Check, X, Clock, Send, Inbox,
} from 'lucide-react-native';
import C from '@/constants/colors';
import Card from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import { ROLE_LABEL, domainForRole, isBusinessRole } from '@/lib/relationships';
import type { UserRole } from '@/constants/types';

const WORLD_COLOR: Record<string, string> = {
  labour: C.purple, logistics: C.accent, freight: C.green, drayage: C.blue,
};

type Tab = 'browse' | 'partners' | 'requests';

interface PartnerRow {
  company_id: string; name: string; city: string | null; primary_type: string;
  held_roles: string[]; rating: number; review_count: number;
  connection_id: string | null; connection_status: string | null; connection_direction: string | null;
}
interface ConnectionRow {
  connection_id: string; other_company_id: string; other_name: string; other_type: string;
  other_city: string | null; status: string; direction: string; note: string; created_at: string;
}

function roleColor(type: string): string {
  return WORLD_COLOR[domainForRole(type as UserRole) ?? 'logistics'] ?? C.accent;
}

export default function PartnersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { activeCompany, activeCompanyId } = useActiveCompany();
  const [tab, setTab] = useState<Tab>('browse');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | null>(null);

  const isBusiness = isBusinessRole(activeCompany?.companyType);

  const partnersQ = useQuery({
    queryKey: ['partners', 'directory', activeCompanyId ?? 'none', roleFilter ?? '', search],
    enabled: Boolean(activeCompanyId) && isBusiness && tab === 'browse',
    queryFn: async (): Promise<PartnerRow[]> => {
      const { data, error } = await supabase.rpc('list_partner_companies', {
        p_company_id: activeCompanyId, p_role_filter: roleFilter, p_search: search.trim() || null,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as PartnerRow[];
    },
  });

  const connectionsQ = useQuery({
    queryKey: ['partners', 'connections', activeCompanyId ?? 'none'],
    enabled: Boolean(activeCompanyId) && isBusiness,
    queryFn: async (): Promise<ConnectionRow[]> => {
      const { data, error } = await supabase.rpc('my_connections', { p_company_id: activeCompanyId });
      if (error) throw new Error(error.message);
      return (data ?? []) as ConnectionRow[];
    },
  });

  const availableRoleFilters = useMemo<UserRole[]>(() => {
    const set = new Set<UserRole>();
    for (const p of partnersQ.data ?? []) set.add(p.primary_type as UserRole);
    return Array.from(set);
  }, [partnersQ.data]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['partners'] });
  };

  const sendMut = useMutation({
    mutationFn: async (targetId: string) => {
      const { error } = await supabase.rpc('send_connection_request', {
        p_from_company_id: activeCompanyId, p_to_company_id: targetId, p_note: '',
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
    onError: (e: Error) => {
      if (Platform.OS === 'web') window.alert(e.message); else Alert.alert('Could not send', e.message);
    },
  });

  const respondMut = useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) => {
      const { error } = await supabase.rpc('respond_connection_request', { p_connection_id: id, p_accept: accept });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
    onError: (e: Error) => {
      if (Platform.OS === 'web') window.alert(e.message); else Alert.alert('Could not respond', e.message);
    },
  });

  const accepted = (connectionsQ.data ?? []).filter((c) => c.status === 'Accepted');
  const incoming = (connectionsQ.data ?? []).filter((c) => c.status === 'Pending' && c.direction === 'incoming');
  const outgoing = (connectionsQ.data ?? []).filter((c) => c.status === 'Pending' && c.direction === 'outgoing');

  const TABS: { id: Tab; label: string; icon: typeof Building2; count?: number }[] = [
    { id: 'browse', label: 'Browse', icon: Search },
    { id: 'partners', label: 'My partners', icon: Handshake, count: accepted.length },
    { id: 'requests', label: 'Requests', icon: Inbox, count: incoming.length },
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Handshake size={18} color={C.accent} />
          <Text style={styles.headerTitle}>Partners</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      {!isBusiness ? (
        <View style={styles.centerBox}>
          <Building2 size={40} color={C.textMuted} />
          <Text style={styles.emptyTitle}>Partners are for businesses</Text>
          <Text style={styles.emptyText}>Individual accounts work through the businesses that hire them.</Text>
        </View>
      ) : (
        <>
          <View style={styles.tabBar}>
            {TABS.map(({ id, label, icon: Icon, count }) => {
              const active = tab === id;
              return (
                <TouchableOpacity key={id} onPress={() => setTab(id)} style={[styles.tabItem, active && styles.tabItemActive]}>
                  <Icon size={15} color={active ? C.accent : C.textMuted} />
                  <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
                  {count ? (
                    <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{count}</Text></View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>

          <ScrollView
            contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={partnersQ.isFetching || connectionsQ.isFetching}
                onRefresh={() => { void partnersQ.refetch(); void connectionsQ.refetch(); }}
                tintColor={C.accent}
              />
            }
          >
            {/* BROWSE */}
            {tab === 'browse' && (
              <>
                <View style={styles.searchBar}>
                  <Search size={16} color={C.textMuted} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search by name or city…"
                    placeholderTextColor={C.textMuted}
                    value={search}
                    onChangeText={setSearch}
                    returnKeyType="search"
                  />
                </View>

                {availableRoleFilters.length > 1 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                    <FilterChip label="All" active={roleFilter === null} onPress={() => setRoleFilter(null)} />
                    {availableRoleFilters.map((r) => (
                      <FilterChip key={r} label={ROLE_LABEL[r] ?? r} active={roleFilter === r} color={roleColor(r)} onPress={() => setRoleFilter(r)} />
                    ))}
                  </ScrollView>
                )}

                {partnersQ.isLoading ? (
                  <ActivityIndicator color={C.accent} style={{ marginTop: 32 }} />
                ) : (partnersQ.data ?? []).length === 0 ? (
                  <EmptyState icon={Building2} title="No companies yet" text="No compatible partners match right now. Try a different search or check back soon." />
                ) : (
                  <View style={styles.list}>
                    {(partnersQ.data ?? []).map((p) => (
                      <PartnerCard
                        key={p.company_id}
                        partner={p}
                        sending={sendMut.isPending}
                        onConnect={() => sendMut.mutate(p.company_id)}
                        onAccept={() => p.connection_id && respondMut.mutate({ id: p.connection_id, accept: true })}
                      />
                    ))}
                  </View>
                )}
              </>
            )}

            {/* MY PARTNERS */}
            {tab === 'partners' && (
              connectionsQ.isLoading ? (
                <ActivityIndicator color={C.accent} style={{ marginTop: 32 }} />
              ) : accepted.length === 0 ? (
                <EmptyState icon={Handshake} title="No partners yet" text="Connect with companies from the Browse tab. Accepted partners show up here and get prioritised when you create work." />
              ) : (
                <View style={styles.list}>
                  {accepted.map((c) => (
                    <ConnectionCard key={c.connection_id} conn={c} />
                  ))}
                </View>
              )
            )}

            {/* REQUESTS */}
            {tab === 'requests' && (
              connectionsQ.isLoading ? (
                <ActivityIndicator color={C.accent} style={{ marginTop: 32 }} />
              ) : incoming.length === 0 && outgoing.length === 0 ? (
                <EmptyState icon={Inbox} title="No pending requests" text="Connection requests you send or receive appear here." />
              ) : (
                <View style={{ gap: 20 }}>
                  {incoming.length > 0 && (
                    <View>
                      <Text style={styles.sectionLabel}>Incoming</Text>
                      <View style={styles.list}>
                        {incoming.map((c) => (
                          <ConnectionCard
                            key={c.connection_id}
                            conn={c}
                            actions={
                              <View style={styles.reqActions}>
                                <TouchableOpacity
                                  style={[styles.smallBtn, styles.declineBtn]}
                                  disabled={respondMut.isPending}
                                  onPress={() => respondMut.mutate({ id: c.connection_id, accept: false })}
                                >
                                  <X size={13} color={C.red} />
                                  <Text style={[styles.smallBtnText, { color: C.red }]}>Decline</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[styles.smallBtn, styles.acceptBtn]}
                                  disabled={respondMut.isPending}
                                  onPress={() => respondMut.mutate({ id: c.connection_id, accept: true })}
                                >
                                  <Check size={13} color={C.white} />
                                  <Text style={[styles.smallBtnText, { color: C.white }]}>Accept</Text>
                                </TouchableOpacity>
                              </View>
                            }
                          />
                        ))}
                      </View>
                    </View>
                  )}
                  {outgoing.length > 0 && (
                    <View>
                      <Text style={styles.sectionLabel}>Sent</Text>
                      <View style={styles.list}>
                        {outgoing.map((c) => (
                          <ConnectionCard
                            key={c.connection_id}
                            conn={c}
                            actions={
                              <View style={styles.pendingPill}>
                                <Clock size={12} color={C.yellow} />
                                <Text style={styles.pendingText}>Pending</Text>
                              </View>
                            }
                          />
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              )
            )}
          </ScrollView>
        </>
      )}
    </View>
  );
}

function FilterChip({ label, active, color, onPress }: { label: string; active: boolean; color?: string; onPress: () => void }) {
  const c = color ?? C.accent;
  return (
    <TouchableOpacity onPress={onPress} style={[styles.filterChip, active && { backgroundColor: c + '22', borderColor: c }]}>
      <Text style={[styles.filterChipText, active && { color: c }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function PartnerCard({ partner, sending, onConnect, onAccept }: {
  partner: PartnerRow; sending: boolean; onConnect: () => void; onAccept: () => void;
}) {
  const color = roleColor(partner.primary_type);
  const status = partner.connection_status;
  const direction = partner.connection_direction;
  return (
    <Card style={styles.partnerCard}>
      <View style={styles.partnerTop}>
        <View style={[styles.avatar, { backgroundColor: color + '20' }]}>
          <Building2 size={20} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.partnerName} numberOfLines={1}>{partner.name}</Text>
          <View style={styles.partnerMetaRow}>
            <View style={[styles.rolePill, { backgroundColor: color + '18', borderColor: color + '44' }]}>
              <Text style={[styles.rolePillText, { color }]}>{ROLE_LABEL[partner.primary_type as UserRole] ?? partner.primary_type}</Text>
            </View>
            {partner.city ? (
              <View style={styles.metaItem}><MapPin size={11} color={C.textMuted} /><Text style={styles.metaText}>{partner.city}</Text></View>
            ) : null}
            {partner.review_count > 0 ? (
              <View style={styles.metaItem}><Star size={11} color={C.yellow} /><Text style={styles.metaText}>{partner.rating.toFixed(1)}</Text></View>
            ) : null}
          </View>
        </View>
      </View>
      <View style={styles.partnerAction}>
        {status === 'Accepted' ? (
          <View style={[styles.connectedPill]}><Check size={13} color={C.green} /><Text style={styles.connectedText}>Connected</Text></View>
        ) : status === 'Pending' && direction === 'incoming' ? (
          <TouchableOpacity style={[styles.smallBtn, styles.acceptBtn]} onPress={onAccept}>
            <Check size={13} color={C.white} /><Text style={[styles.smallBtnText, { color: C.white }]}>Accept request</Text>
          </TouchableOpacity>
        ) : status === 'Pending' ? (
          <View style={styles.pendingPill}><Clock size={12} color={C.yellow} /><Text style={styles.pendingText}>Requested</Text></View>
        ) : (
          <TouchableOpacity style={[styles.connectBtn, sending && { opacity: 0.6 }]} disabled={sending} onPress={onConnect}>
            <Send size={13} color={C.white} /><Text style={styles.connectBtnText}>Connect</Text>
          </TouchableOpacity>
        )}
      </View>
    </Card>
  );
}

function ConnectionCard({ conn, actions }: { conn: ConnectionRow; actions?: React.ReactNode }) {
  const color = roleColor(conn.other_type);
  return (
    <Card style={styles.partnerCard}>
      <View style={styles.partnerTop}>
        <View style={[styles.avatar, { backgroundColor: color + '20' }]}>
          <Building2 size={20} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.partnerName} numberOfLines={1}>{conn.other_name}</Text>
          <View style={styles.partnerMetaRow}>
            <View style={[styles.rolePill, { backgroundColor: color + '18', borderColor: color + '44' }]}>
              <Text style={[styles.rolePillText, { color }]}>{ROLE_LABEL[conn.other_type as UserRole] ?? conn.other_type}</Text>
            </View>
            {conn.other_city ? (
              <View style={styles.metaItem}><MapPin size={11} color={C.textMuted} /><Text style={styles.metaText}>{conn.other_city}</Text></View>
            ) : null}
          </View>
          {conn.note ? <Text style={styles.noteText} numberOfLines={2}>“{conn.note}”</Text> : null}
        </View>
      </View>
      {actions ? <View style={styles.partnerAction}>{actions}</View> : null}
    </Card>
  );
}

function EmptyState({ icon: Icon, title, text }: { icon: typeof Building2; title: string; text: string }) {
  return (
    <View style={styles.centerBox}>
      <View style={styles.emptyIcon}><Icon size={26} color={C.textMuted} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border, marginHorizontal: 12 },
  tabItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabItemActive: { borderBottomColor: C.accent },
  tabLabel: { fontSize: 12, fontWeight: '600' as const, color: C.textMuted },
  tabLabelActive: { color: C.accent },
  tabBadge: { backgroundColor: C.red, borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tabBadgeText: { fontSize: 10, fontWeight: '700' as const, color: C.white },
  scroll: { paddingHorizontal: 16, paddingTop: 14 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, height: 44, marginBottom: 12 },
  searchInput: { flex: 1, color: C.text, fontSize: 14 },
  filterRow: { gap: 8, paddingBottom: 14, paddingRight: 8 },
  filterChip: { borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, paddingHorizontal: 14, paddingVertical: 7 },
  filterChipText: { fontSize: 12, fontWeight: '600' as const, color: C.textSecondary },
  list: { gap: 10 },
  sectionLabel: { fontSize: 12, fontWeight: '700' as const, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginBottom: 10 },
  partnerCard: { padding: 14, gap: 12 },
  partnerTop: { flexDirection: 'row', gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  partnerName: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 5 },
  partnerMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rolePill: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  rolePillText: { fontSize: 11, fontWeight: '700' as const },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 11, color: C.textMuted, fontWeight: '600' as const },
  noteText: { fontSize: 12, color: C.textSecondary, fontStyle: 'italic' as const, marginTop: 8 },
  partnerAction: { flexDirection: 'row', justifyContent: 'flex-end' },
  connectBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 },
  connectBtnText: { fontSize: 13, fontWeight: '700' as const, color: C.white },
  connectedPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.greenDim, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  connectedText: { fontSize: 12, fontWeight: '700' as const, color: C.green },
  pendingPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.yellowDim, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  pendingText: { fontSize: 12, fontWeight: '700' as const, color: C.yellow },
  reqActions: { flexDirection: 'row', gap: 8 },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  declineBtn: { borderWidth: 1, borderColor: C.red + '66', backgroundColor: C.redDim },
  acceptBtn: { backgroundColor: C.green },
  smallBtnText: { fontSize: 13, fontWeight: '700' as const },
  centerBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 32, gap: 8 },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text, textAlign: 'center' as const },
  emptyText: { fontSize: 13, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 19 },
});
