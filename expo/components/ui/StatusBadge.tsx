import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import C from '@/constants/colors';

const STATUS_CONFIG: Record<string, { bg: string; text: string; label?: string }> = {
  Draft:          { bg: C.statusDraft, text: C.textMuted },
  PendingApproval:{ bg: C.yellowDim, text: C.yellow, label: 'Pending' },
  Available:      { bg: C.greenDim, text: C.green },
  Hidden:         { bg: C.statusDraft, text: C.textMuted },
  Suspended:      { bg: C.redDim, text: C.red },
  Active:         { bg: C.greenDim, text: C.green },
  Approved:       { bg: C.greenDim, text: C.green },
  Requested:      { bg: C.blueDim, text: C.blue },
  Accepted:       { bg: C.greenDim, text: C.green },
  CounterOffered: { bg: C.accentDim, text: C.accent, label: 'Counter Offer' },
  Confirmed:      { bg: C.purpleDim, text: C.purple },
  Scheduled:      { bg: C.purpleDim, text: C.purple },
  InProgress:     { bg: C.yellowDim, text: C.yellow, label: 'In Progress' },
  Completed:      { bg: C.greenDim, text: C.green },
  Cancelled:      { bg: C.redDim, text: C.red },
  Posted:         { bg: C.blueDim, text: C.blue },
  Filled:         { bg: C.purpleDim, text: C.purple },
  Applied:        { bg: C.blueDim, text: C.blue },
  Rejected:       { bg: C.redDim, text: C.red },
  Withdrawn:      { bg: C.statusDraft, text: C.textMuted },
  NoShow:         { bg: C.redDim, text: C.red, label: 'No Show' },
  Disputed:       { bg: C.redDim, text: C.red },
  Open:           { bg: C.redDim, text: C.red },
  UnderReview:    { bg: C.yellowDim, text: C.yellow, label: 'Under Review' },
  Resolved:       { bg: C.greenDim, text: C.green },
  Pending:        { bg: C.yellowDim, text: C.yellow },
  Paid:           { bg: C.greenDim, text: C.green },
  Refunded:       { bg: C.blueDim, text: C.blue },
};

interface Props {
  status: string;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'sm' }: Props) {
  const cfg = STATUS_CONFIG[status] ?? { bg: C.border, text: C.textSecondary };
  const label = cfg.label ?? status;
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }, size === 'md' && styles.badgeMd]}>
      <Text style={[styles.text, { color: cfg.text }, size === 'md' && styles.textMd]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  badgeMd: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
  },
  text: {
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
  },
  textMd: {
    fontSize: 13,
  },
});
