import createContextHook from '@nkzw/create-context-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

const LAST_COMPANY_KEY = 'dock2door-last-active-company';

export interface Membership {
  companyId: string;
  companyName: string;
  companyType: string;
  role: 'Owner' | 'Staff';
}

interface MembershipRow {
  company_id: string;
  company_role: 'Owner' | 'Staff';
  companies: { id: string; name: string; type: string } | null;
}

async function fetchMyMemberships(userId: string): Promise<Membership[]> {
  const { data, error } = await supabase
    .from('company_users')
    .select('company_id, company_role, companies(id, name, type)')
    .eq('user_id', userId)
    .eq('status', 'Active')
    .returns<MembershipRow[]>();
  if (error) {
    console.log('[ActiveCompany] fetchMemberships error', error.message);
    return [];
  }
  return (data ?? [])
    .filter((r): r is MembershipRow & { companies: NonNullable<MembershipRow['companies']> } => Boolean(r.companies))
    .map((r) => ({
      companyId: r.company_id,
      companyName: r.companies.name,
      companyType: r.companies.type,
      role: r.company_role,
    }));
}

async function pushActiveCompanyToPg(companyId: string | null): Promise<void> {
  try {
    await supabase.rpc('set_active_company', { p_company_id: companyId });
    console.log('[ActiveCompany] synced to pg GUC', companyId);
  } catch (error) {
    console.log('[ActiveCompany] set_active_company rpc failed', error);
  }
}

export const [ActiveCompanyProvider, useActiveCompany] = createContextHook(() => {
  const user = useAuthStore((s) => s.user);
  const [activeCompanyId, setActiveCompanyIdState] = useState<string | null>(null);

  const membershipsQuery = useQuery({
    queryKey: ['activeCompany', 'memberships', user?.id ?? 'anon'],
    queryFn: () => (user ? fetchMyMemberships(user.id) : Promise.resolve([] as Membership[])),
    enabled: Boolean(user),
    staleTime: 60_000,
  });

  const syncMutation = useMutation({
    mutationFn: (companyId: string | null) => pushActiveCompanyToPg(companyId),
  });

  const memberships = useMemo<Membership[]>(() => membershipsQuery.data ?? [], [membershipsQuery.data]);

  useEffect(() => {
    if (!user) {
      setActiveCompanyIdState(null);
      return;
    }
    if (memberships.length === 0) return;
    if (activeCompanyId && memberships.some((m) => m.companyId === activeCompanyId)) return;
    (async () => {
      const stored = await AsyncStorage.getItem(`${LAST_COMPANY_KEY}:${user.id}`);
      const valid = stored && memberships.some((m) => m.companyId === stored) ? stored : memberships[0].companyId;
      setActiveCompanyIdState(valid);
      syncMutation.mutate(valid);
    })();
  }, [user, memberships, activeCompanyId, syncMutation]);

  const setActiveCompanyId = useCallback(
    async (companyId: string | null) => {
      console.log('[ActiveCompany] switch', companyId);
      setActiveCompanyIdState(companyId);
      if (user) {
        if (companyId) {
          await AsyncStorage.setItem(`${LAST_COMPANY_KEY}:${user.id}`, companyId);
        } else {
          await AsyncStorage.removeItem(`${LAST_COMPANY_KEY}:${user.id}`);
        }
      }
      syncMutation.mutate(companyId);
    },
    [user, syncMutation],
  );

  const activeCompany = useMemo<Membership | null>(
    () => memberships.find((m) => m.companyId === activeCompanyId) ?? null,
    [memberships, activeCompanyId],
  );

  return {
    memberships,
    activeCompany,
    activeCompanyId,
    isLoading: membershipsQuery.isLoading,
    isSyncing: syncMutation.isPending,
    setActiveCompanyId,
    refresh: membershipsQuery.refetch,
  };
});
