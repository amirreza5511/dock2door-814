import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, User, MessageSquare, Star } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StarRating from '@/components/ui/StarRating';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface WorkerReviewRow {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
  reviewerCompanyName?: string;
  contextKind: string;
}

export default function WorkerReviewsScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const summaryQuery = trpc.reviews.workerSummary.useQuery({ userId: String(userId) }, { enabled: Boolean(userId) });
  const listQuery = trpc.reviews.listForWorker.useQuery({ userId: String(userId) }, { enabled: Boolean(userId) });

  const reviews = useMemo<WorkerReviewRow[]>(() => (listQuery.data ?? []) as WorkerReviewRow[], [listQuery.data]);
  const summary = (summaryQuery.data ?? { count: 0, avg_rating: 0 }) as { count: number; avg_rating: number };

  if (listQuery.isLoading) return <View style={[styles.root, styles.centered]}><ScreenFeedback state="loading" title="Loading reviews" /></View>;
  if (listQuery.isError) return <View style={[styles.root, styles.centered]}><ScreenFeedback state="error" title="Unable to load" onRetry={() => void listQuery.refetch()} /></View>;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>Worker Ratings</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 80 }]}>
        <Card elevated style={styles.summaryCard}>
          <View style={styles.summaryIcon}><User size={20} color={C.blue} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.summaryNumber}>{Number(summary.avg_rating ?? 0).toFixed(1)}</Text>
            <StarRating value={Math.round(Number(summary.avg_rating ?? 0))} readonly size={16} />
            <Text style={styles.summaryCount}>{summary.count ?? 0} employer review{Number(summary.count) === 1 ? '' : 's'}</Text>
          </View>
        </Card>

        {reviews.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No reviews yet" description="Employer ratings from confirmed shifts will appear here." />
        ) : reviews.map((r) => (
          <Card key={r.id} style={styles.reviewCard}>
            <View style={styles.reviewTop}>
              <StarRating value={r.rating} readonly size={14} />
              <Text style={styles.dateText}>{new Date(r.createdAt).toLocaleDateString()}</Text>
            </View>
            {r.comment ? <Text style={styles.comment}>"{r.comment}"</Text> : null}
            <View style={styles.reviewBottom}>
              <Star size={12} color={C.textMuted} />
              <Text style={styles.reviewer}>{r.reviewerCompanyName ?? 'Employer'} · {r.contextKind.replace('_', ' ')}</Text>
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  centered: { flex: 1, justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  scroll: { padding: 16, gap: 12 },
  summaryCard: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  summaryIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: C.blueDim, alignItems: 'center', justifyContent: 'center' },
  summaryNumber: { fontSize: 32, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  summaryCount: { fontSize: 12, color: C.textSecondary, marginTop: 6 },
  reviewCard: { gap: 10, padding: 14 },
  reviewTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateText: { fontSize: 11, color: C.textMuted },
  comment: { fontSize: 13, color: C.text, lineHeight: 19, fontStyle: 'italic' },
  reviewBottom: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4, borderTopWidth: 1, borderTopColor: C.border },
  reviewer: { fontSize: 11, color: C.textSecondary, fontWeight: '600' as const },
});
