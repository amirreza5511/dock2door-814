import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Search } from 'lucide-react-native';
import C from '@/constants/colors';

interface SearchFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  testID?: string;
}

export default function SearchField({ value, onChangeText, placeholder, testID }: SearchFieldProps) {
  return (
    <View style={styles.root} testID={testID ?? 'search-field'}>
      <Search size={16} color={C.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? 'Search'}
        placeholderTextColor={C.textMuted}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.bgSecondary,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 46,
  },
  input: {
    flex: 1,
    color: C.text,
    fontSize: 14,
    paddingVertical: 12,
  },
});
