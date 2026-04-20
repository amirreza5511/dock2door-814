import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FileCheck2 } from 'lucide-react-native';
import AttachmentList from '@/components/ui/AttachmentList';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

export default function DriverPodScreen() {
  const insets = useSafeAreaInsets();
  const jobsQuery = trpc.operations.driverJobs.useQuery();

  if (jobsQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading POD records" /></View>;
  }

  if (jobsQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load POD records" onRetry={() => void jobsQuery.refetch()} /></View>;
  }

  const items = (jobsQuery.data ?? []).filter((job) => Boolean(job.data?.podFileId));

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}> 
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Proof of Delivery</Text>
        <Text style={styles.subtitle}>Attachment-ready POD references from completed routes.</Text>
        {items.length === 0 ? <EmptyState icon={FileCheck2} title="No POD records yet" description="Saved POD file references will appear here." /> : items.map((job) => (
          <Card key={String(job.id)} style={styles.card}>
            <Text style={styles.cardTitle}>{String(job.appointment_type)}</Text>
            <Text style={styles.cardMeta}>{String(job.id)}</Text>
            <AttachmentList items={[{ id: String(job.data?.podFileId), label: `POD ${String(job.data?.podFileId)}` }]} />
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 4, marginBottom: 8 },
  card: { marginTop: 10, gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  cardMeta: { fontSize: 12, color: C.textSecondary },
});
