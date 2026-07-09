"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";

/**
 * Web data hooks for the Sales Agent role. These mirror the mobile app's
 * `sales.*` tRPC procedures exactly, but run directly against Supabase from the
 * browser using the signed-in agent's session. RLS scopes every row to the
 * current agent, so `agent_id = auth.uid()`.
 */

export interface SalesAgent {
  id: string;
  agent_code: string | null;
  status: string | null;
  phone: string | null;
  territory: string | null;
  payout_method: string | null;
  payout_details: string | null;
  legal_name: string | null;
  business_name: string | null;
  plan_id: string | null;
  plan: { id: string; name: string } | null;
  [key: string]: unknown;
}

export interface SalesDashboard {
  pending: number;
  approved: number;
  paid: number;
  lifetime: number;
  accounts: number;
  leads: number;
  openLeads: number;
}

export interface AgentLead {
  id: string;
  business_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  city: string | null;
  vertical: string | null;
  status: string;
  priority: string | null;
  estimated_value: number | null;
  next_action: string | null;
  notes: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface CommissionEntry {
  id: string;
  amount: number;
  status: string;
  kind: string | null;
  vertical: string | null;
  description: string | null;
  source_id: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface SalesClient {
  id: string;
  name: string;
  email: string;
  city: string;
  vertical: string;
  source: string;
  onboardStatus: "Signed up" | "Setting up" | "Active";
  companyStatus: string;
  earned: number;
  createdAt: string;
}

export interface SalesClientDetail extends Omit<SalesClient, "earned"> {
  address: string;
  hasCompany: boolean;
  commissions: CommissionEntry[];
}

async function currentUserId(): Promise<string> {
  const supabase = getBrowserSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not authenticated");
  return data.user.id;
}

/** Current agent record; self-heals a missing agent row + code via ensure_sales_agent. */
export function useMyAgent() {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["sales", "myAgent"],
    queryFn: async (): Promise<SalesAgent | null> => {
      const uid = await currentUserId();
      let { data } = await supabase.from("sales_agents").select("*").eq("id", uid).maybeSingle();
      if (!data) {
        await supabase.rpc("ensure_sales_agent", { p_user_id: uid });
        const res = await supabase.from("sales_agents").select("*").eq("id", uid).maybeSingle();
        data = res.data;
      }
      if (!data) return null;
      let plan: { id: string; name: string } | null = null;
      if (data.plan_id) {
        const { data: p } = await supabase.from("commission_plans").select("id, name").eq("id", data.plan_id).maybeSingle();
        plan = (p as { id: string; name: string } | null) ?? null;
      }
      return { ...(data as SalesAgent), plan };
    },
  });
}

export function useSalesDashboard() {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["sales", "dashboard"],
    queryFn: async (): Promise<SalesDashboard> => {
      const uid = await currentUserId();
      const [entries, attrs, leads] = await Promise.all([
        supabase.from("commission_entries").select("amount, status").eq("agent_id", uid),
        supabase.from("agent_attributions").select("id").eq("agent_id", uid),
        supabase.from("agent_leads").select("id, status").eq("agent_id", uid),
      ]);
      const rows = (entries.data as { amount: number; status: string }[] | null) ?? [];
      const sum = (s: string) => rows.filter((r) => r.status === s).reduce((a, r) => a + Number(r.amount || 0), 0);
      const leadRows = (leads.data as { status: string }[] | null) ?? [];
      return {
        pending: sum("Pending"),
        approved: sum("Approved"),
        paid: sum("Paid"),
        lifetime: sum("Pending") + sum("Approved") + sum("Paid"),
        accounts: (attrs.data ?? []).length,
        leads: leadRows.length,
        openLeads: leadRows.filter((l) => l.status !== "Won" && l.status !== "Lost").length,
      };
    },
  });
}

export function useSalesLeads() {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["sales", "leads"],
    queryFn: async (): Promise<AgentLead[]> => {
      const uid = await currentUserId();
      const { data, error } = await supabase.from("agent_leads").select("*").eq("agent_id", uid).order("created_at", { ascending: false });
      if (error) throw error;
      return (data as AgentLead[] | null) ?? [];
    },
  });
}

export interface SaveLeadInput {
  id?: string;
  businessName: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  city?: string;
  vertical?: string;
  status?: string;
  priority?: string;
  estimatedValue?: number;
  nextAction?: string;
  notes?: string;
}

export function useSaveLead() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveLeadInput) => {
      const { data, error } = await supabase.rpc("agent_save_lead", {
        p: {
          id: input.id ?? null,
          business_name: input.businessName ?? "",
          contact_name: input.contactName ?? "",
          contact_title: "",
          contact_email: input.contactEmail ?? "",
          contact_phone: input.contactPhone ?? "",
          company_website: "",
          city: input.city ?? "",
          vertical: input.vertical ?? "warehouse",
          status: input.status ?? "New",
          priority: input.priority ?? "Medium",
          source: "",
          estimated_value: Number(input.estimatedValue ?? 0) || 0,
          next_action: input.nextAction ?? "",
          next_action_at: "",
          last_contact_at: "",
          notes: input.notes ?? "",
        },
      });
      if (error) throw error;
      return { id: data as string };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sales", "leads"] });
      void qc.invalidateQueries({ queryKey: ["sales", "dashboard"] });
    },
  });
}

export function useSalesCommissions() {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["sales", "commissions"],
    queryFn: async (): Promise<CommissionEntry[]> => {
      const uid = await currentUserId();
      const { data, error } = await supabase.from("commission_entries").select("*").eq("agent_id", uid).order("created_at", { ascending: false });
      if (error) throw error;
      return (data as CommissionEntry[] | null) ?? [];
    },
  });
}

export function useSalesClients() {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["sales", "clients"],
    queryFn: async (): Promise<SalesClient[]> => {
      const uid = await currentUserId();
      const { data: attrs, error } = await supabase.from("agent_attributions").select("*").eq("agent_id", uid).order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (attrs as Record<string, unknown>[] | null) ?? [];
      if (rows.length === 0) return [];
      const companyIds = Array.from(new Set(rows.map((r) => r.account_company_id as string | null).filter(Boolean))) as string[];
      const userIds = Array.from(new Set(rows.map((r) => r.account_user_id as string | null).filter(Boolean))) as string[];
      const attrIds = rows.map((r) => r.id as string);
      const [companies, profiles, entries] = await Promise.all([
        companyIds.length ? supabase.from("companies").select("id, name, type, status, city").in("id", companyIds) : Promise.resolve({ data: [] }),
        userIds.length ? supabase.from("profiles").select("id, name, email").in("id", userIds) : Promise.resolve({ data: [] }),
        supabase.from("commission_entries").select("amount, status, source_id").eq("agent_id", uid).in("source_id", attrIds),
      ]);
      const compMap = new Map(((companies.data as Record<string, unknown>[] | null) ?? []).map((c) => [c.id as string, c]));
      const profMap = new Map(((profiles.data as Record<string, unknown>[] | null) ?? []).map((p) => [p.id as string, p]));
      const entryRows = (entries.data as { amount: number; status: string; source_id: string }[] | null) ?? [];
      return rows.map((r) => {
        const comp = r.account_company_id ? compMap.get(r.account_company_id as string) : undefined;
        const prof = r.account_user_id ? profMap.get(r.account_user_id as string) : undefined;
        const compStatus = (comp?.status as string | undefined) ?? undefined;
        let onboardStatus: SalesClient["onboardStatus"] = "Signed up";
        if (comp) onboardStatus = compStatus === "Approved" ? "Active" : "Setting up";
        else if (prof) onboardStatus = "Active";
        const mine = entryRows.filter((e) => e.source_id === (r.id as string));
        const earned = mine.reduce((a, e) => a + Number(e.amount || 0), 0);
        return {
          id: r.id as string,
          name: (comp?.name as string | undefined) ?? (prof?.name as string | undefined) ?? "Client",
          email: (prof?.email as string | undefined) ?? "",
          city: (comp?.city as string | undefined) ?? "",
          vertical: r.vertical as string,
          source: r.source as string,
          onboardStatus,
          companyStatus: compStatus ?? "",
          earned,
          createdAt: r.created_at as string,
        };
      });
    },
  });
}

export function useSalesClientDetail(id: string) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["sales", "clientDetail", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<SalesClientDetail | null> => {
      const uid = await currentUserId();
      const { data: attr, error } = await supabase.from("agent_attributions").select("*").eq("id", id).eq("agent_id", uid).maybeSingle();
      if (error) throw error;
      if (!attr) return null;
      const a = attr as Record<string, unknown>;
      const [company, profile, entries] = await Promise.all([
        a.account_company_id ? supabase.from("companies").select("id, name, type, status, city, address").eq("id", a.account_company_id as string).maybeSingle() : Promise.resolve({ data: null }),
        a.account_user_id ? supabase.from("profiles").select("id, name, email, role").eq("id", a.account_user_id as string).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from("commission_entries").select("*").eq("agent_id", uid).eq("source_id", a.id as string).order("created_at", { ascending: false }),
      ]);
      const comp = company.data as Record<string, unknown> | null;
      const prof = profile.data as Record<string, unknown> | null;
      const compStatus = (comp?.status as string | undefined) ?? undefined;
      let onboardStatus: SalesClient["onboardStatus"] = "Signed up";
      if (comp) onboardStatus = compStatus === "Approved" ? "Active" : "Setting up";
      else if (prof) onboardStatus = "Active";
      return {
        id: a.id as string,
        name: (comp?.name as string | undefined) ?? (prof?.name as string | undefined) ?? "Client",
        email: (prof?.email as string | undefined) ?? "",
        city: (comp?.city as string | undefined) ?? "",
        address: (comp?.address as string | undefined) ?? "",
        vertical: a.vertical as string,
        source: a.source as string,
        onboardStatus,
        companyStatus: compStatus ?? "",
        hasCompany: Boolean(comp),
        createdAt: a.created_at as string,
        commissions: (entries.data as CommissionEntry[] | null) ?? [],
      };
    },
  });
}

export interface SaveProfileInput {
  legalName?: string;
  businessName?: string;
  phone?: string;
  territory?: string;
  city?: string;
  region?: string;
  website?: string;
  bio?: string;
  payoutMethod?: string;
  payoutDetails?: string;
}

export function useSaveAgentProfile() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveProfileInput) => {
      const { error } = await supabase.rpc("agent_save_profile", {
        p: {
          legal_name: input.legalName,
          business_name: input.businessName,
          phone: input.phone,
          territory: input.territory,
          city: input.city,
          region: input.region,
          website: input.website,
          bio: input.bio,
          payout_method: input.payoutMethod,
          payout_details: input.payoutDetails,
        },
      });
      if (error) throw error;
      return { success: true };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sales", "myAgent"] });
      void qc.invalidateQueries({ queryKey: ["sales", "dashboard"] });
    },
  });
}

export function money(n: number): string {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
