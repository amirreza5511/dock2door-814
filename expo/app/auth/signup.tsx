import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Check } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import type { UserRole } from '@/constants/types';

const ROLES: { role: UserRole; label: string; desc: string }[] = [
  { role: 'Customer', label: 'Customer', desc: 'Book warehouse space & services' },
  { role: 'WarehouseProvider', label: 'Warehouse Provider', desc: 'List and manage storage space' },
  { role: 'ServiceProvider', label: 'Service Provider', desc: 'Offer industrial services' },
  { role: 'Employer', label: 'Employer', desc: 'Post and manage work shifts' },
  { role: 'Worker', label: 'Worker', desc: 'Find and apply for shifts' },
  { role: 'TruckingCompany', label: 'Trucking Company', desc: 'Manage drivers, fleet, and appointments' },
  { role: 'Driver', label: 'Driver', desc: 'View assigned jobs and upload PODs' },
  { role: 'GateStaff', label: 'Gate Staff', desc: 'Run dock and gate check-ins' },
  { role: 'SuperAdmin', label: 'Super Admin', desc: 'Control platform-wide operations' },
];

export default function Signup() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const register = useAuthStore((s) => s.register);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [city, setCity] = useState('Vancouver');
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRegister = async () => {
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    if (!email.trim()) { setError('Email is required'); return; }
    if (!password || password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (!selectedRole) { setError('Please select your role'); return; }
    if (!['Worker', 'Driver', 'SuperAdmin'].includes(selectedRole) && !companyName.trim()) { setError('Company name is required for this role'); return; }

    setLoading(true);
    try {
      const result = await register({ name: name.trim(), email: email.trim(), password, role: selectedRole, companyName: companyName.trim(), city: city.trim() });
      if (!result.success) {
        setError(result.error ?? 'Registration failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient colors={['#0D1E35', C.bg]} style={styles.heroBg} />

        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <ArrowLeft size={20} color={C.textSecondary} />
        </TouchableOpacity>

        <View style={styles.header}>
          <View style={styles.logoRow}>
            <View style={styles.logoDot} />
            <Text style={styles.logoText}>Dock2Door</Text>
          </View>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Join BC&apos;s logistics marketplace</Text>
        </View>

        <View style={styles.form}>
          <Input label="Full Name" value={name} onChangeText={setName} placeholder="Jane Smith" testID="input-name" />
          <Input label="Email" value={email} onChangeText={setEmail} placeholder="you@company.ca" keyboardType="email-address" autoCapitalize="none" testID="input-email" />
          <Input label="Password" value={password} onChangeText={setPassword} placeholder="Min. 6 characters" secureTextEntry testID="input-password" />
          {!['Worker', 'Driver', 'SuperAdmin'].includes(selectedRole ?? '') ? (
            <>
              <Input label="Company Name" value={companyName} onChangeText={setCompanyName} placeholder="Dock2Door Logistics Ltd." testID="input-company-name" />
              <Input label="City" value={city} onChangeText={setCity} placeholder="Vancouver" testID="input-city" />
            </>
          ) : null}

          <View>
            <Text style={styles.roleLabel}>Your Role</Text>
            <View style={styles.rolesGrid}>
              {ROLES.map((r) => {
                const selected = selectedRole === r.role;
                return (
                  <TouchableOpacity
                    key={r.role}
                    onPress={() => setSelectedRole(r.role)}
                    style={[styles.roleCard, selected && styles.roleCardSelected]}
                    activeOpacity={0.8}
                    testID={`role-${r.role}`}
                  >
                    {selected && (
                      <View style={styles.checkIcon}>
                        <Check size={12} color={C.white} />
                      </View>
                    )}
                    <Text style={[styles.roleTitle, selected && styles.roleTitleSelected]}>{r.label}</Text>
                    <Text style={styles.roleDesc}>{r.desc}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            label="Create Account"
            onPress={handleRegister}
            loading={loading}
            fullWidth
            size="lg"
            disabled={!selectedRole}
          />

          <TouchableOpacity onPress={() => router.push('/auth/login' as any)} style={styles.switchRow}>
            <Text style={styles.switchText}>Already have an account? </Text>
            <Text style={styles.switchLink}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },
  back: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
  header: { marginBottom: 32 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
  logoDot: { width: 8, height: 8, borderRadius: 2, backgroundColor: C.accent },
  logoText: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  title: { fontSize: 32, fontWeight: '800' as const, color: C.text, letterSpacing: -0.8, marginBottom: 8 },
  subtitle: { fontSize: 16, color: C.textSecondary },
  form: { gap: 16 },
  roleLabel: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary, marginBottom: 10, letterSpacing: 0.3 },
  rolesGrid: { gap: 8 },
  roleCard: {
    padding: 14, borderRadius: 12,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    position: 'relative',
  },
  roleCardSelected: { borderColor: C.accent, backgroundColor: C.accentDim },
  checkIcon: {
    position: 'absolute', top: 10, right: 10,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center',
  },
  roleTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 2 },
  roleTitleSelected: { color: C.accent },
  roleDesc: { fontSize: 12, color: C.textSecondary },
  error: { fontSize: 13, color: C.red, textAlign: 'center' },
  switchRow: { flexDirection: 'row', justifyContent: 'center' },
  switchText: { fontSize: 14, color: C.textSecondary },
  switchLink: { fontSize: 14, color: C.accent, fontWeight: '600' as const },
});
