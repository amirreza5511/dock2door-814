import React, { useState } from 'react';
import { Modal, View, Text, StyleSheet, TextInput, Alert, TouchableOpacity } from 'react-native';
import { X } from 'lucide-react-native';
import StarRating from '@/components/ui/StarRating';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

export type ReviewContextKind = 'warehouse_booking' | 'service_job' | 'shift_assignment';
export type ReviewTargetKind = 'company' | 'worker';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
  title: string;
  subtitle?: string;
  contextKind: ReviewContextKind;
  contextId: string;
  targetKind: ReviewTargetKind;
  targetCompanyId?: string | null;
  targetUserId?: string | null;
}

export default function ReviewModal({
  visible,
  onClose,
  onSubmitted,
  title,
  subtitle,
  contextKind,
  contextId,
  targetKind,
  targetCompanyId,
  targetUserId,
}: Props) {
  const [rating, setRating] = useState<number>(0);
  const [comment, setComment] = useState<string>('');
  const utils = trpc.useUtils();
  const postMutation = trpc.reviews.post.useMutation();

  const handleSubmit = () => {
    if (rating < 1) {
      Alert.alert('Rating required', 'Please select 1–5 stars.');
      return;
    }
    postMutation.mutate(
      {
        contextKind,
        contextId,
        targetKind,
        targetCompanyId: targetCompanyId ?? null,
        targetUserId: targetUserId ?? null,
        rating,
        comment: comment.trim(),
      },
      {
        onSuccess: async () => {
          await utils.reviews.summaries.invalidate();
          await utils.reviews.listMineByContext.invalidate();
          if (targetCompanyId) await utils.reviews.listForCompany.invalidate({ companyId: targetCompanyId });
          if (targetUserId) await utils.reviews.listForWorker.invalidate({ userId: targetUserId });
          setRating(0);
          setComment('');
          onSubmitted?.();
          onClose();
        },
        onError: (err: Error) => {
          Alert.alert('Unable to submit review', err.message);
        },
      },
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="review-modal">
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.close}>
              <X size={20} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.starsWrap}>
            <StarRating value={rating} onChange={setRating} size={36} testID="review-stars" />
            <Text style={styles.ratingLabel}>{rating === 0 ? 'Tap to rate' : `${rating} / 5`}</Text>
          </View>

          <Text style={styles.label}>Comment (optional)</Text>
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="Share your experience…"
            placeholderTextColor={C.textMuted}
            multiline
            style={styles.input}
            testID="review-comment"
          />

          <Button
            label={postMutation.isPending ? 'Submitting…' : 'Submit review'}
            onPress={handleSubmit}
            disabled={postMutation.isPending}
            fullWidth
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.bgSecondary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 30,
    gap: 14,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  close: { padding: 6 },
  starsWrap: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  ratingLabel: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  label: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  input: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 12,
    color: C.text,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
  },
});
