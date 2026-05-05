import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, XCircle, Images, User } from 'lucide-react-native';
import C from '@/constants/colors';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { supabase } from '@/lib/supabase';
import { trpc } from '@/lib/trpc';

interface WorkPhotoRow {
  id: string;
  worker_user_id: string;
  file_path: string;
  caption: string | null;
  visibility: string;
  moderation_status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  created_at: string;
}

export default function AdminWorkPhotos() {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const moderate = trpc.workPhotos.adminModerate.useMutation({ onSuccess: async () => { await utils.dock.bootstrap.invalidate(); await photosQ.refetch(); } });
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [reason, setReason] = useState('');

  const photosQ = useQuery({
    queryKey: ['admin-work-photos', filter],
    queryFn: async (): Promise<WorkPhotoRow[]> => {
      let q = supabase.from('work_photos').select('id,worker_user_id,file_path,caption,visibility,moderation_status,rejection_reason,created_at').order('created_at', { ascending: false }).limit(200);
      if (filter !== 'all') q = q.eq('moderation_status', filter);
      const { data, error } = await q.returns<WorkPhotoRow[]>();
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const photos = useMemo(() => photosQ.data ?? [], [photosQ.data]);

  const approve = (photoId: string) => moderate.mutate({ photoId, status: 'approved' }, { onError: (e: unknown) => Alert.alert('Unable to approve', e instanceof Error ? e.message : 'Unknown error') });
  const reject = (photoId: string) => {
    if (reason.trim().length < 3) { Alert.alert('Reason required', 'Enter a rejection reason first.'); return; }
    moderate.mutate({ photoId, status: 'rejected', reason }, { onError: (e: unknown) => Alert.alert('Unable to reject', e instanceof Error ? e.message : 'Unknown error') });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}> 
      <View style={styles.header}>
        <Text style={styles.title}>Work Photo Moderation</Text>
        <Text style={styles.sub}>{photos.length} photos</Text>
      </View>
      <View style={styles.tabs}>
        {(['pending','approved','rejected','all'] as const).map((f) => (
          <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.tab, filter === f && styles.tabActive]}>
            <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.reasonWrap}><Input label="Reject reason" value={reason} onChangeText={setReason} placeholder="Blurry / unsafe / not work related" /></View>
      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 80 }]}>
        {photos.length === 0 ? <Card><Text style={styles.empty}>No photos in this queue.</Text></Card> : photos.map((p) => (
          <Card key={p.id} style={styles.card}>
            <View style={styles.row}>
              <Image source={{ uri: p.file_path }} style={styles.thumb} />
              <View style={{ flex: 1 }}>
                <View style={styles.workerRow}><User size={13} color={C.textMuted} /><Text style={styles.worker}>{p.worker_user_id.slice(0, 8)}…</Text></View>
                <Text style={styles.meta}>{p.visibility} · {p.moderation_status} · {p.created_at.split('T')[0]}</Text>
                {p.rejection_reason ? <Text style={styles.reject}>Reason: {p.rejection_reason}</Text> : null}
                <View style={styles.actions}>
                  <TouchableOpacity onPress={() => approve(p.id)} style={[styles.action, styles.approve]}><CheckCircle size={13} color={C.green} /><Text style={[styles.actionText, { color: C.green }]}>Approve</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => reject(p.id)} style={[styles.action, styles.rejectBtn]}><XCircle size={13} color={C.red} /><Text style={[styles.actionText, { color: C.red }]}>Reject</Text></TouchableOpacity>
                </View>
              </View>
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 20, paddingBottom: 10 },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  tabActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  tabText: { fontSize: 11, color: C.textMuted, fontWeight: '800' as const, textTransform: 'capitalize' as const },
  tabTextActive: { color: C.accent },
  reasonWrap: { paddingHorizontal: 16, paddingBottom: 10 },
  list: { padding: 16, gap: 10 },
  card: { gap: 8 },
  row: { flexDirection: 'row', gap: 12 },
  thumb: { width: 88, height: 88, borderRadius: 12, backgroundColor: C.bgSecondary },
  workerRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  worker: { fontSize: 13, fontWeight: '800' as const, color: C.text },
  meta: { fontSize: 12, color: C.textSecondary, marginTop: 3, textTransform: 'capitalize' as const },
  reject: { fontSize: 12, color: C.red, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8 },
  approve: { backgroundColor: C.greenDim },
  rejectBtn: { backgroundColor: C.redDim },
  actionText: { fontSize: 12, fontWeight: '800' as const },
  empty: { textAlign: 'center', color: C.textMuted, fontStyle: 'italic' as const },
});
