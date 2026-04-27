"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";

export interface ActiveCompany {
  company_id: string;
  role: string;
  company_name: string;
  company_type: string;
}

export function useMyCompanies() {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["my", "company_members"],
    queryFn: async (): Promise<ActiveCompany[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from("company_users")
        .select("company_id, role, companies!inner(name, type)")
        .eq("user_id", u.user.id);
      if (error) throw error;
      type Row = { company_id: string; role: string; companies: { name: string; type: string } | { name: string; type: string }[] | null };
      return (data as Row[] | null ?? []).map((r) => {
        const c = Array.isArray(r.companies) ? r.companies[0] : r.companies;
        return {
          company_id: r.company_id,
          role: r.role,
          company_name: c?.name ?? "",
          company_type: c?.type ?? "",
        };
      });
    },
  });
}

export function useActiveCompanyId(typeFilter?: string): string | undefined {
  const { data } = useMyCompanies();
  if (!data || data.length === 0) return undefined;
  if (typeFilter) {
    const match = data.find((c) => c.company_type === typeFilter);
    if (match) return match.company_id;
  }
  return data[0].company_id;
}
