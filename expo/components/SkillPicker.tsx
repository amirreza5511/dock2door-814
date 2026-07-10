import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Check } from 'lucide-react-native';
import C from '@/constants/colors';
import { SKILL_GROUPS } from '@/constants/skills';
import type { ShiftCategory } from '@/constants/types';

interface SkillPickerProps {
  /** Currently selected skill ids. */
  selected: ShiftCategory[];
  /** Called when a skill chip is toggled. */
  onToggle: (skill: ShiftCategory) => void;
  /** Disable all interaction (e.g. while saving). */
  disabled?: boolean;
}

/**
 * Grouped multi-select chips for the full skills catalog. Used on the worker
 * profile (skills a worker lists) and employer job posting (skills a job needs).
 */
export default function SkillPicker({ selected, onToggle, disabled = false }: SkillPickerProps) {
  return (
    <View style={styles.root}>
      {SKILL_GROUPS.map((group) => (
        <View key={group.key} style={styles.group}>
          <Text style={styles.groupTitle}>{group.title}</Text>
          <View style={styles.chipRow}>
            {group.skills.map((skill) => {
              const active = selected.includes(skill.id);
              return (
                <TouchableOpacity
                  key={skill.id}
                  disabled={disabled}
                  onPress={() => onToggle(skill.id)}
                  style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}
                  activeOpacity={0.7}
                >
                  {active ? <Check size={12} color={C.accent} /> : null}
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{skill.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 16 },
  group: { gap: 8 },
  groupTitle: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipDisabled: { opacity: 0.6 },
  chipText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  chipTextActive: { color: C.accent },
});
