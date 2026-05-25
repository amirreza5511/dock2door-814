import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  ActivityIndicator, TextInput, Image, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import {
  ArrowLeft, Mail, Phone, User as UserIcon, Building2, LogOut,
  Camera, Save, Shield, ChevronRight, Star, Bell,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '@/store/auth';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import C from '@/constants/colors';
import Card from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';

const AVATAR_BUCKET = 'worker-photos';

export default function EmployerAccountScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const logout = useAuthStore((s) => s.logout);

  const { companies } = useDockBootstrapData().data;
  const company = companies.find((c) => c.id === user?.companyId);

  const [name, setName] = useState<string>(user?.name ?? '');
  const [phone, setPhone] = useState<string>('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.profileImage ?? null);
  const [saving, setSaving] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [loadingPhone, setLoadingPhone] = useState<boolean>(true);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('phone, profile_image, name')
          .eq('id', user.id)
          .maybeSingle();
        if (error) console.log('[account] load error', error.message);
        if (cancelled) return;
        if (data) {
          const row = data as { phone: string | null; profile_image: string | null; name: string };
          setPhone(row.phone ?? '');
          if (row.profile_image) setAvatarUrl(row.profile_image);
          if (row.name) setName(row.name);
        }
      } catch (e) {
        console.log('[account] load failed', e);
      } finally {
        if (!cancelled) setLoadingPhone(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const onSave = useCallback(async () => {
    if (!user?.id) return;
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      Alert.alert('Invalid name', 'Please enter your full name.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ name: trimmedName, phone: phone.trim() })
        .eq('id', user.id);
      if (error) throw error;
      updateUser({ name: trimmedName });
      Alert.alert('Saved', 'Your account details have been updated.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save changes';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  }, [name, phone, user?.id, updateUser]);

  const onPickAvatar = useCallback(async () => {
    if (!user?.id) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please allow photo library access.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });
      if (result.canceled || !result.assets[0]) return;
      setUploading(true);
      const asset = result.assets[0];
      const mime = asset.mimeType ?? 'image/jpeg';
      const ext = mime.includes('png') ? 'png' : 'jpg';
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;

      let blob: Blob;
      if (Platform.OS === 'web') {
        const res = await fetch(asset.uri);
        blob = await res.blob();
      } else if (asset.base64) {
        const byteString = typeof atob === 'function' ? atob(asset.base64) : Buffer.from(asset.base64, 'base64').toString('binary');
        const buf = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i += 1) buf[i] = byteString.charCodeAt(i);
        blob = new Blob([buf], { type: mime });
      } else {
        const res = await fetch(asset.uri);
        blob = await res.blob();
      }

      const { error: upErr } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, {
        contentType: mime,
        upsert: true,
      });
      if (upErr) throw upErr;

      const { data: signed } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
      const url = signed?.signedUrl ?? null;

      const { error: updErr } = await supabase
        .from('profiles')
        .update({ profile_image: url })
        .eq('id', user.id);
      if (updErr) throw updErr;

      setAvatarUrl(url);
      updateUser({ profileImage: url ?? undefined });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not upload photo';
      console.log('[account] avatar upload failed', msg);
      Alert.alert('Upload failed', msg);
    } finally {
      setUploading(false);
    }
  }, [user?.id, updateUser]);

  const onLogout = useCallback(() => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => { void logout(); } },
    ]);
  }, [logout]);

  const initials = (name || user?.email || 'E').slice(0, 1).toUpperCase();

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Account</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={onPickAvatar} style={styles.avatarWrap} disabled={uploading}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
            <View style={styles.avatarCamera}>
              {uploading ? (
                <ActivityIndicator size="small" color={C.white} />
              ) : (
                <Camera size={14} color={C.white} />
              )}
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarHint}>Tap to change photo</Text>
        </View>

        {/* Personal details */}
        <Card style={styles.card}>
          <Text style={styles.cardLabel}>PERSONAL DETAILS</Text>

          <View style={styles.field}>
            <View style={styles.fieldRow}>
              <UserIcon size={14} color={C.textSecondary} />
              <Text style={styles.fieldLabel}>Full name</Text>
            </View>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={C.textMuted}
              style={styles.input}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.field}>
            <View style={styles.fieldRow}>
              <Mail size={14} color={C.textSecondary} />
              <Text style={styles.fieldLabel}>Email</Text>
            </View>
            <View style={[styles.input, styles.inputDisabled]}>
              <Text style={styles.inputDisabledText}>{user?.email ?? '—'}</Text>
            </View>
            <Text style={styles.hint}>Email is managed by your account and can't be changed here.</Text>
          </View>

          <View style={styles.field}>
            <View style={styles.fieldRow}>
              <Phone size={14} color={C.textSecondary} />
              <Text style={styles.fieldLabel}>Phone</Text>
            </View>
            {loadingPhone ? (
              <View style={[styles.input, styles.inputDisabled]}>
                <ActivityIndicator size="small" color={C.textMuted} />
              </View>
            ) : (
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="+1 555 000 0000"
                placeholderTextColor={C.textMuted}
                style={styles.input}
                keyboardType="phone-pad"
              />
            )}
          </View>

          <TouchableOpacity
            onPress={onSave}
            disabled={saving}
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          >
            {saving ? (
              <ActivityIndicator size="small" color={C.white} />
            ) : (
              <>
                <Save size={16} color={C.white} />
                <Text style={styles.saveBtnText}>Save Changes</Text>
              </>
            )}
          </TouchableOpacity>
        </Card>

        {/* Company link */}
        <Card style={styles.card}>
          <Text style={styles.cardLabel}>COMPANY</Text>
          <TouchableOpacity
            onPress={() => router.push('/employer/company-profile' as any)}
            style={styles.linkRow}
          >
            <View style={[styles.linkIcon, { backgroundColor: C.accent + '20' }]}>
              <Building2 size={18} color={C.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>{company?.name ?? 'Set up company'}</Text>
              <Text style={styles.linkSub}>
                {company ? `${company.status}` : 'Required before posting shifts'}
              </Text>
            </View>
            <ChevronRight size={18} color={C.textMuted} />
          </TouchableOpacity>
        </Card>

        {/* Quick links */}
        <Card style={styles.card}>
          <Text style={styles.cardLabel}>ACCOUNT</Text>

          <TouchableOpacity
            onPress={() => router.push('/reviews' as any)}
            style={styles.linkRow}
          >
            <View style={[styles.linkIcon, { backgroundColor: C.yellow + '20' }]}>
              <Star size={18} color={C.yellow} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Reviews about my company</Text>
              <Text style={styles.linkSub}>Ratings from workers</Text>
            </View>
            <ChevronRight size={18} color={C.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/notifications' as any)}
            style={styles.linkRow}
          >
            <View style={[styles.linkIcon, { backgroundColor: C.blue + '20' }]}>
              <Bell size={18} color={C.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Notifications</Text>
              <Text style={styles.linkSub}>Inbox and alerts</Text>
            </View>
            <ChevronRight size={18} color={C.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/auth/update-password' as any)}
            style={styles.linkRow}
          >
            <View style={[styles.linkIcon, { backgroundColor: C.purple + '20' }]}>
              <Shield size={18} color={C.purple} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Change password</Text>
              <Text style={styles.linkSub}>Update your sign-in password</Text>
            </View>
            <ChevronRight size={18} color={C.textMuted} />
          </TouchableOpacity>
        </Card>

        <TouchableOpacity onPress={onLogout} style={styles.logoutBtn}>
          <LogOut size={16} color={C.red} />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.bgSecondary,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.card,
  },
  headerTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  avatarSection: { alignItems: 'center', marginVertical: 16 },
  avatarWrap: { position: 'relative' },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  avatarFallback: { backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 36, fontWeight: '800' as const, color: C.white },
  avatarCamera: {
    position: 'absolute', right: 0, bottom: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.bg,
  },
  avatarHint: { marginTop: 8, fontSize: 12, color: C.textSecondary },
  card: { padding: 16, marginBottom: 12 },
  cardLabel: {
    fontSize: 11, fontWeight: '700' as const, color: C.textSecondary,
    letterSpacing: 0.8, marginBottom: 12,
  },
  field: { marginBottom: 14 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  fieldLabel: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  input: {
    backgroundColor: C.card,
    borderWidth: 1, borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 14, color: C.text,
  },
  inputDisabled: { justifyContent: 'center' },
  inputDisabledText: { fontSize: 14, color: C.textSecondary },
  hint: { fontSize: 11, color: C.textMuted, marginTop: 4 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    backgroundColor: C.accent,
    paddingVertical: 12, borderRadius: 10,
    marginTop: 4,
  },
  saveBtnText: { color: C.white, fontWeight: '700' as const, fontSize: 14 },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10,
  },
  linkIcon: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  linkTitle: { fontSize: 14, fontWeight: '600' as const, color: C.text },
  linkSub: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    backgroundColor: C.redDim,
    borderWidth: 1, borderColor: C.red + '40',
    paddingVertical: 12, borderRadius: 10,
    marginTop: 8,
  },
  logoutText: { color: C.red, fontWeight: '700' as const, fontSize: 14 },
});
