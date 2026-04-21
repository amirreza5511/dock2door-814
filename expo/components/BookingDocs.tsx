import React, { useCallback, useMemo } from 'react';
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Upload, FileText } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '@/lib/supabase';
import {
  buildBookingDocPath,
  getSignedUrl,
  uploadFileWithMetadata,
} from '@/lib/storage-files';
import C from '@/constants/colors';

interface Props {
  bookingId: string;
  uploaderCompanyId: string;
}

interface StorageFileRow {
  id: string;
  bucket: string;
  path: string;
  mime: string | null;
  size_bytes: number | null;
  uploader_user_id: string | null;
  created_at: string;
}

async function listBookingDocs(bookingId: string): Promise<StorageFileRow[]> {
  const { data, error } = await supabase
    .from('storage_files')
    .select('id,bucket,path,mime,size_bytes,uploader_user_id,created_at')
    .eq('bucket', 'booking-docs')
    .eq('entity_type', 'warehouse_booking')
    .eq('entity_id', bookingId)
    .order('created_at', { ascending: false })
    .returns<StorageFileRow[]>();
  if (error) {
    console.log('[BookingDocs] list failed', error.message);
    throw new Error(error.message);
  }
  return data ?? [];
}

export default function BookingDocs({ bookingId, uploaderCompanyId }: Props) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['bookingDocs', bookingId] as const, [bookingId]);

  const docsQuery = useQuery({
    queryKey,
    queryFn: () => listBookingDocs(bookingId),
    staleTime: 15_000,
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return null;
      const asset = picked.assets[0];
      const filename = asset.name ?? `doc-${Date.now()}`;
      const mime = asset.mimeType ?? 'application/octet-stream';

      const path = buildBookingDocPath(bookingId, uploaderCompanyId, filename);

      let body: Blob;
      if (Platform.OS === 'web' && asset.file) {
        body = asset.file;
      } else {
        const res = await fetch(asset.uri);
        body = await res.blob();
      }

      return uploadFileWithMetadata({
        bucket: 'booking-docs',
        path,
        file: body,
        contentType: mime,
        entityType: 'warehouse_booking',
        entityId: bookingId,
        companyId: uploaderCompanyId,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: unknown) => {
      Alert.alert('Upload failed', err instanceof Error ? err.message : 'Unknown error');
    },
  });

  const openDoc = useCallback(async (row: StorageFileRow) => {
    try {
      const url = await getSignedUrl('booking-docs', row.path, 60);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(url, '_blank');
      } else {
        const { Linking } = await import('react-native');
        await Linking.openURL(url);
      }
    } catch (err) {
      Alert.alert('Unable to open file', err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  return (
    <View style={styles.root} testID="booking-docs">
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Paperclip size={15} color={C.text} />
          <Text style={styles.headerTitle}>Documents</Text>
        </View>
        <TouchableOpacity
          style={styles.uploadBtn}
          onPress={() => uploadMutation.mutate()}
          disabled={uploadMutation.isPending}
          testID="booking-docs-upload"
        >
          <Upload size={13} color={C.accent} />
          <Text style={styles.uploadBtnText}>
            {uploadMutation.isPending ? 'Uploading…' : 'Upload'}
          </Text>
        </TouchableOpacity>
      </View>

      {docsQuery.isLoading ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : (docsQuery.data ?? []).length === 0 ? (
        <Text style={styles.empty}>No documents yet.</Text>
      ) : (
        <View style={styles.list}>
          {(docsQuery.data ?? []).map((row) => {
            const label = row.path.split('/').pop() ?? row.path;
            return (
              <TouchableOpacity key={row.id} style={styles.item} onPress={() => void openDoc(row)}>
                <View style={styles.iconWrap}>
                  <FileText size={15} color={C.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemLabel} numberOfLines={1}>{label}</Text>
                  <Text style={styles.itemMeta}>
                    {row.mime ?? '—'} · {row.size_bytes ? `${Math.round((row.size_bytes ?? 0) / 1024)} KB` : '—'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.accentDim, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: C.accent + '40',
  },
  uploadBtnText: { fontSize: 12, color: C.accent, fontWeight: '700' as const },
  list: { gap: 8 },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  iconWrap: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: C.accentDim,
    alignItems: 'center', justifyContent: 'center',
  },
  itemLabel: { fontSize: 13, color: C.text, fontWeight: '600' as const },
  itemMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  empty: { fontSize: 13, color: C.textMuted },
});
