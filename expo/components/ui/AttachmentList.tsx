import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FileText, ExternalLink } from 'lucide-react-native';
import C from '@/constants/colors';

export interface AttachmentItem {
  id: string;
  label: string;
  url?: string | null;
}

interface AttachmentListProps {
  items: AttachmentItem[];
  emptyLabel?: string;
  testID?: string;
}

export default function AttachmentList({ items, emptyLabel, testID }: AttachmentListProps) {
  if (items.length === 0) {
    return <Text style={styles.empty} testID={testID ?? 'attachment-empty'}>{emptyLabel ?? 'No attachments yet.'}</Text>;
  }

  return (
    <View style={styles.list} testID={testID ?? 'attachment-list'}>
      {items.map((item) => (
        <TouchableOpacity
          key={item.id}
          activeOpacity={0.8}
          onPress={() => {
            if (item.url) {
              void Linking.openURL(item.url);
            }
          }}
          disabled={!item.url}
          style={styles.item}
        >
          <View style={styles.iconWrap}>
            <FileText size={16} color={C.accent} />
          </View>
          <Text style={styles.label}>{item.label}</Text>
          {item.url ? <ExternalLink size={15} color={C.textMuted} /> : null}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.bgSecondary,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: C.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    fontSize: 13,
    color: C.text,
    fontWeight: '600' as const,
  },
  empty: {
    fontSize: 13,
    color: C.textMuted,
  },
});
