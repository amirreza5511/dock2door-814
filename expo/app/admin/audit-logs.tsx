import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, Filter, Search, X } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import EmptyState from '@/components/ui/EmptyState';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface AuditLog {
  id: string;
  actor_user_id: string | null;
  company_id: string | null;
  entity_name: string;
  entity_id: string;
  action: string;
  previous_value: unknown;
  new_value: unknown;
  request_id: string | null;
  created_at: string;
}

export default function AdminAuditLogs() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [entity, setEntity] = useState<string>('');
  const [entityId, setEntityId] = useState<string>('');
  const [actorUserId, setActorUserId] = useState<string>('');
  const [companyId, setCompanyId] = useState<string>('');
  const [appliedFilters, setAppliedFilters] = useState<{ entity?: string; entityId?: string; actorUserId?: string; companyId?: string }>({});

  const logsQuery = trpc.admin.auditLogs.useQuery({
    entity: appliedFilters.entity || undefined,
    entityId: appliedFilters.entityId || undefined,
    actorUserId: appliedFilters.actorUserId || undefined,
    companyId: appliedFilters.companyId || undefined,
    limit: 200,
  });

  const apply = () => {
    setAppliedFilters({
      entity: entity.trim() || undefined,
      entityId: entityId.trim() || undefined,
      actorUserId: actorUserId.trim() || undefined,
      companyId: companyId.trim() || undefined,
    });
  };

  const clear = () => {
    setEntity(''); setEntityId(''); setActorUserId(''); setCompanyId('');
    setAppliedFilters({});
  };

  const logs = (logsQuery.data ?? []) as AuditLog[];

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Audit Logs</Text>
          <Text style={styles.sub}>{logs.length} records</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <Card style={styles.filterCard}>
          <View style={styles.filterHeader}>
            <Filter size={14} color={C.textSecondary} />
            <Text style={styles.filterTitle}>Filters</Text>
          </View>
          <View style={styles.fieldGrid}>
            <Field label="Entity" value={entity} onChangeText={setEntity} placeholder="bookings, payments, ..." />
            <Field label="Entity ID" value={entityId} onChangeText={setEntityId} placeholder="uuid" />
            <Field label="Actor User ID" value={actorUserId} onChangeText={setActorUserId} placeholder="uuid" />
            <Field label="Company ID" value={companyId} onChangeText={setCompanyId} placeholder="uuid" />
          </View>
          <View style={styles.filterBtns}>
            <Button label="Apply" onPress={apply} size="sm" icon={<Search size={14} color={C.white} />} />
            <Button label="Clear" onPress={clear} size="sm" variant="ghost" icon={<X size={14} color={C.textSecondary} />} />
          </View>
        </Card>

        {logsQuery.isLoading ? (
          <ScreenFeedback state="loading" title="Loading audit logs" />
        ) : logsQuery.isError ? (
          <ScreenFeedback state="error" title="Unable to load audit logs" onRetry={() => void logsQuery.refetch()} />
        ) : logs.length === 0 ? (
          <EmptyState icon={Filter} title="No audit records" description="Try adjusting the filters above." />
        ) : (
          logs.map((log) => (
            <Card key={log.id} style={styles.logCard}>
              <View style={styles.logTop}>
                <Text style={styles.logAction}>{log.action.toUpperCase()}</Text>
                <Text style={styles.logTime}>{new Date(log.created_at).toLocaleString()}</Text>
              </View>
              <Text style={styles.logEntity}>{log.entity_name} · {log.entity_id.slice(0, 12)}</Text>
              <View style={styles.logMeta}>
                {log.actor_user_id ? <Text style={styles.metaText}>actor: {log.actor_user_id.slice(0, 8)}</Text> : null}
                {log.company_id ? <Text style={styles.metaText}>company: {log.company_id.slice(0, 8)}</Text> : null}
              </View>
              {log.new_value ? (
                <View style={styles.payloadBox}>
                  <Text style={styles.payloadLabel}>new</Text>
                  <Text style={styles.payloadText} numberOfLines={4}>{JSON.stringify(log.new_value)}</Text>
                </View>
              ) : null}
              {log.previous_value ? (
                <View style={styles.payloadBox}>
                  <Text style={styles.payloadLabel}>previous</Text>
                  <Text style={styles.payloadText} numberOfLines={4}>{JSON.stringify(log.previous_value)}</Text>
                </View>
              ) : null}
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function Field({ label, value, onChangeText, placeholder }: { label: string; value: string; onChangeText: (v: string) => void; placeholder?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.textMuted}
        style={styles.input}
        autoCapitalize="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 16, gap: 10 },
  filterCard: { padding: 14, gap: 10 },
  filterHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  filterTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  field: { flexGrow: 1, flexBasis: '45%', gap: 4 },
  fieldLabel: { fontSize: 11, color: C.textMuted, fontWeight: '600' as const },
  input: { backgroundColor: C.card, borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, paddingVertical: 8, color: C.text, fontSize: 13 },
  filterBtns: { flexDirection: 'row', gap: 8 },
  logCard: { padding: 12, gap: 6 },
  logTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logAction: { fontSize: 12, fontWeight: '800' as const, color: C.accent, letterSpacing: 0.5 },
  logTime: { fontSize: 11, color: C.textMuted },
  logEntity: { fontSize: 13, color: C.text, fontWeight: '600' as const },
  logMeta: { flexDirection: 'row', gap: 10 },
  metaText: { fontSize: 11, color: C.textSecondary, fontFamily: 'monospace' as const },
  payloadBox: { backgroundColor: C.bgSecondary, borderRadius: 8, padding: 8, borderWidth: 1, borderColor: C.border },
  payloadLabel: { fontSize: 10, color: C.textMuted, marginBottom: 2, fontWeight: '700' as const },
  payloadText: { fontSize: 11, color: C.textSecondary, fontFamily: 'monospace' as const },
});
