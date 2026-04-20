import React, { useState } from 'react';
import { View, TextInput, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import C from '@/constants/colors';

interface Props {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  multiline?: boolean;
  numberOfLines?: number;
  error?: string;
  editable?: boolean;
  testID?: string;
}

export default function Input({
  label, value, onChangeText, placeholder, secureTextEntry,
  keyboardType = 'default', autoCapitalize = 'sentences',
  multiline, numberOfLines, error, editable = true, testID,
}: Props) {
  const [show, setShow] = useState(false);

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.inputWrap, error && styles.inputError, !editable && styles.inputDisabled]}>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={C.textMuted}
          secureTextEntry={secureTextEntry && !show}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          multiline={multiline}
          numberOfLines={numberOfLines}
          editable={editable}
          style={[styles.input, multiline && styles.multiline]}
        />
        {secureTextEntry && (
          <TouchableOpacity onPress={() => setShow(!show)} style={styles.eyeBtn}>
            {show ? <EyeOff size={18} color={C.textMuted} /> : <Eye size={18} color={C.textMuted} />}
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary, letterSpacing: 0.3 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.bgSecondary,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  inputError: { borderColor: C.red },
  inputDisabled: { opacity: 0.6 },
  input: { flex: 1, color: C.text, fontSize: 15, paddingVertical: 12 },
  multiline: { paddingTop: 12, textAlignVertical: 'top', minHeight: 80 },
  eyeBtn: { padding: 4 },
  error: { fontSize: 12, color: C.red },
});
