"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";

export interface InvoiceRow {
  id: string;
  number: string | null;
  provider_company_id: string | null;
  customer_company_id: string | null;
  customer_name: string | null;
  status: string;
  currency: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  total: number | null;
  due_date: string | null;
  created_at: string | null;
  [k: string]: unknown;
}

export interface AccountingSummary {
  collected: number;
  outstanding: number;
  overdue: number;
  draft: number;
  expenses: number;
  net: number;
  invoiceCount: number;
}

export function useInvoices(providerCompanyId: string | null) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["invoicing", "list", providerCompanyId],
    enabled: !!providerCompanyId,
    queryFn: async (): Promise<InvoiceRow[]> => {
      if (!providerCompanyId) return [];
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .or(`provider_company_id.eq.${providerCompanyId},customer_company_id.eq.${providerCompanyId}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data as InvoiceRow[] | null) ?? []).filter(
        (r) => String(r.provider_company_id ?? "") === String(providerCompanyId),
      );
    },
  });
}

export function useAccountingSummary(companyId: string | null) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["invoicing", "summary", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<AccountingSummary | null> => {
      if (!companyId) return null;
      const { data, error } = await supabase.rpc("company_accounting_summary", { p_company_id: companyId });
      if (error) throw error;
      return (data as AccountingSummary | null) ?? null;
    },
  });
}

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

export function useCreateInvoice(providerCompanyId: string | null) {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      customerCompanyId?: string | null;
      customerName?: string;
      customerEmail?: string;
      currency?: string;
      taxRate?: number;
      dueDays?: number;
      notes?: string;
      status?: "Draft" | "Issued";
      lines: InvoiceLineInput[];
    }) => {
      if (!providerCompanyId) throw new Error("You must belong to a company to send invoices");
      const cleanLines = input.lines
        .filter((l) => l.description.trim().length > 0)
        .map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity) || 0, unit_price: Number(l.unitPrice) || 0 }));
      if (cleanLines.length === 0) throw new Error("Add at least one line item");
      const { data, error } = await supabase.rpc("create_provider_invoice", {
        p_provider_company_id: providerCompanyId,
        p_customer_company_id: input.customerCompanyId ?? null,
        p_customer_name: input.customerName ?? "",
        p_customer_email: input.customerEmail ?? "",
        p_currency: input.currency ?? "CAD",
        p_tax_rate: Number(input.taxRate) || 0,
        p_due_days: Number.isFinite(input.dueDays) ? Number(input.dueDays) : 14,
        p_notes: input.notes ?? "",
        p_lines: cleanLines,
        p_status: input.status ?? "Issued",
      });
      if (error) throw error;
      return { id: data as string };
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["invoicing"] });
    },
  });
}

export function useSetInvoiceStatus() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: "Issued" | "Void" | "Paid"; method?: string }) => {
      const { error } = await supabase.rpc("provider_set_invoice_status", {
        p_invoice_id: input.id,
        p_status: input.status,
        p_method: input.method ?? "manual",
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["invoicing"] });
    },
  });
}

export function useCustomerCompanies(companyId: string | null) {
  const supabase = getBrowserSupabase();
  return useQuery({
    queryKey: ["invoicing", "customers", companyId],
    queryFn: async (): Promise<{ id: string; name: string; type: string; city: string }[]> => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, type, city, status")
        .eq("status", "Approved")
        .order("name", { ascending: true });
      if (error) throw error;
      return ((data as { id: string; name: string; type: string; city: string }[] | null) ?? [])
        .filter((c) => String(c.id) !== String(companyId ?? ""))
        .map((c) => ({ id: String(c.id), name: c.name ?? "Company", type: c.type ?? "", city: c.city ?? "" }));
    },
  });
}

/** Convenience: resolves the active company for a given role type. */
export function useProviderCompanyId(roleType: string): string | null {
  return useActiveCompanyId(roleType) ?? null;
}
