import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Mail, Bell, MessageSquare } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

export default function NotificationPreferences() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const query = trpc.notifications.getPreferences.useQuery();
  const save = trpc.notifications.savePreferences.useMutation();

  const [email, setEmail] = useState<boolean>(true);
  const [push, setPush] = useState<boolean>(true);
  const [sms, setSms] = useState<boolean>(false);

  useEffect(() => {
    const d = query.data as { email_enabled?: boolean; push_enabled?: boolean; sms_enabled?: boolean } | undefined;
    if (d) {
      setEmail(Boolean(d.email_enabled ?? true));
      setPush(Boolean(d.push_enabled ?? true));
      setSms(Boolean(d.sms_enabled ?? false));
    }
  }, [query.data]);

  const onSave = async () => {
    try {
      await save.mutateAsync({ email, push, sms });
      Alert.alert('Saved', 'Your notification preferences have been updated.');
    } catch (error) {
      Alert.alert('Unable to save', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  if (query.isLoading) {
    return <View style={[styles.root, styles.centered]}><ScreenFeedback state="loading" title="Loading" /></View>;
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>Notification Preferences</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}>
        <Card style={styles.card}>
          <Row icon={<Mail size={18} color={C.blue} />} label="Email" value={email} onChange={setEmail} />
          <Row icon={<Bell size={18} color={C.accent} />} label="Push" value={push} onChange={setPush} />
          <Row icon={<MessageSquare size={18} color={C.green} />} label="SMS" value={sms} onChange={setSms} />
        </Card>
        <Button label="Save preferences" onPress={() => void onSave()} loading={save.isPending} fullWidth size="lg" />
      </ScrollView>
    </View>
  );
}

function Row({ icon, label, value, onChange }: { icon: React.ReactNode; label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>{icon}</View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} thumbColor={C.white} trackColor={{ false: C.border, true: C.accent }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  centered: { flex: 1, justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  scroll: { padding: 16, gap: 14 },
  card: { gap: 4, padding: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '600' as const, color: C.text },
});
