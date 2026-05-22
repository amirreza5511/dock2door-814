"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Building2,
  Award,
  Warehouse,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  ClipboardCheck,
  ExternalLink,
  FileSearch,
  Loader2,
  Wrench,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

// ─── Types ──────────────────────────────────────────────────────────────────

interface PendingCompany {
  id: string;
  name: string;
  type: string;
  city: string | null;
  created_at: string;
}

interface PendingCert {
  id: string;
  worker_user_id: string;
  type: string;
  expiry_date: string | null;
  file_path: string | null;
  created_at: string;
  worker_name: string | null;
  worker_email: string | null;
}

interface PendingListing {
  id: string;
  company_id: string;
  name: string;
  city: string | null;
  warehouse_type: string;
  created_at: string;
  company_name: string | null;
}

interface PendingServiceListing {
  id: string;
  company_id: string;
  category: string;
  coverage_area: string[] | null;
  created_at: string;
  company_name: string | null;
}

interface OpenDispute {
  id: string;
  status: string;
  description: string;
  created_at: string;
  opener_name: string | null;
  opener_email: string | null;
}

// ─── Action Dialog ───────────────────────────────────────────────────────────

type ActionType =
  | { kind: "approve-company"; id: string; name: string }
  | { kind: "suspend-company"; id: string; name: string }
  | { kind: "approve-cert"; id: string; workerName: string; certType: string }
  | { kind: "reject-cert"; id: string; workerName: string; certType: string }
  | { kind: "approve-listing"; id: string; name: string }
  | { kind: "suspend-listing"; id: string; name: string }
  | { kind: "approve-service-listing"; id: string; name: string }
  | { kind: "suspend-service-listing"; id: string; name: string };

function reasonRequired(a: ActionType): boolean {
  return (
    a.kind === "suspend-company" ||
    a.kind === "reject-cert" ||
    a.kind === "suspend-listing" ||
    a.kind === "suspend-service-listing"
  );
}

function actionTitle(a: ActionType): string {
  switch (a.kind) {
    case "approve-company":          return `Approve company: ${a.name}`;
    case "suspend-company":          return `Suspend company: ${a.name}`;
    case "approve-cert":             return `Approve ${a.certType} cert for ${a.workerName}`;
    case "reject-cert":              return `Reject ${a.certType} cert for ${a.workerName}`;
    case "approve-listing":          return `Approve warehouse listing: ${a.name}`;
    case "suspend-listing":          return `Suspend warehouse listing: ${a.name}`;
    case "approve-service-listing":  return `Approve service listing: ${a.name}`;
    case "suspend-service-listing":  return `Suspend service listing: ${a.name}`;
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

type Tab = "companies" | "certifications" | "listings" | "service-listings" | "disputes";

export default function CompliancePage() {
  const supabase = getBrowserSupabase();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("companies");
  const [action, setAction] = useState<ActionType | null>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [fileLoadingId, setFileLoadingId] = useState<string | null>(null);

  /** Open the uploaded certificate file directly via a signed URL (60s expiry). */
  const openCertFile = async (certId: string, filePath: string) => {
    setFileLoadingId(certId);
    try {
      const { data, error } = await supabase.storage
        .from("certifications")
        .createSignedUrl(filePath, 60);
      if (error || !data?.signedUrl) throw new Error(error?.message ?? "Unable to generate preview link");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("[compliance] openCertFile", err);
      alert(`Could not open file: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setFileLoadingId(null);
    }
  };

  // ── Queries ──────────────────────────────────────────────────────────────

  const companiesQ = useQuery({
    queryKey: ["compliance", "companies"],
    queryFn: async (): Promise<PendingCompany[]> => {
      const { data, error } = await supabase
        .from("companies")
        .select("id,name,type,city,created_at")
        .eq("status", "PendingApproval")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PendingCompany[];
    },
    staleTime: 30_000,
  });

  const certsQ = useQuery({
    queryKey: ["compliance", "certs"],
    queryFn: async (): Promise<PendingCert[]> => {
      const { data, error } = await supabase
        .from("worker_certifications")
        .select(
          "id,worker_user_id,type,expiry_date,file_path,created_at,profiles!worker_user_id(name,email)"
        )
        .eq("status", "Pending")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        worker_user_id: r.worker_user_id,
        type: r.type,
        expiry_date: r.expiry_date,
        file_path: r.file_path,
        created_at: r.created_at,
        worker_name: r.profiles?.name ?? null,
        worker_email: r.profiles?.email ?? null,
      }));
    },
    staleTime: 30_000,
  });

  const listingsQ = useQuery({
    queryKey: ["compliance", "listings"],
    queryFn: async (): Promise<PendingListing[]> => {
      const { data, error } = await supabase
        .from("warehouse_listings")
        .select(
          "id,company_id,name,city,warehouse_type,created_at,companies!company_id(name)"
        )
        .eq("status", "PendingApproval")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        company_id: r.company_id,
        name: r.name,
        city: r.city,
        warehouse_type: r.warehouse_type,
        created_at: r.created_at,
        company_name: r.companies?.name ?? null,
      }));
    },
    staleTime: 30_000,
  });

  const serviceListingsQ = useQuery({
    queryKey: ["compliance", "service-listings"],
    queryFn: async (): Promise<PendingServiceListing[]> => {
      const { data, error } = await supabase
        .from("service_listings")
        .select(
          "id,company_id,category,coverage_area,created_at,companies!company_id(name)"
        )
        .eq("status", "PendingApproval")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        company_id: r.company_id,
        category: r.category,
        coverage_area: r.coverage_area ?? null,
        created_at: r.created_at,
        company_name: r.companies?.name ?? null,
      }));
    },
    staleTime: 30_000,
  });

  const disputesQ = useQuery({
    queryKey: ["compliance", "disputes"],
    queryFn: async (): Promise<OpenDispute[]> => {
      const { data, error } = await supabase
        .from("disputes")
        .select(
          "id,status,description,created_at,profiles!opened_by_user_id(name,email)"
        )
        .in("status", ["Open", "UnderReview"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        status: r.status,
        description: r.description,
        created_at: r.created_at,
        opener_name: r.profiles?.name ?? null,
        opener_email: r.profiles?.email ?? null,
      }));
    },
    staleTime: 30_000,
  });

  // ── Mutation ─────────────────────────────────────────────────────────────

  const executeMutation = useMutation({
    mutationFn: async () => {
      if (!action) return;
      const r = reason.trim() || null;

      switch (action.kind) {
        case "approve-company": {
          const { error } = await supabase.rpc("admin_set_company_status", {
            p_company_id: action.id,
            p_status: "Approved",
            p_reason: r ?? "Approved via compliance queue",
          });
          if (error) throw new Error(error.message);
          break;
        }
        case "suspend-company": {
          if (!r) throw new Error("Reason required to suspend a company");
          const { error } = await supabase.rpc("admin_set_company_status", {
            p_company_id: action.id,
            p_status: "Suspended",
            p_reason: r,
          });
          if (error) throw new Error(error.message);
          break;
        }
        case "approve-cert": {
          const { error } = await supabase.rpc("admin_approve_certification", {
            p_cert_id: action.id,
            p_reason: r,
          });
          if (error) throw new Error(error.message);
          break;
        }
        case "reject-cert": {
          if (!r) throw new Error("Reason required to reject a certification");
          const { error } = await supabase.rpc("admin_reject_certification", {
            p_cert_id: action.id,
            p_reason: r,
          });
          if (error) throw new Error(error.message);
          break;
        }
        case "approve-listing": {
          const { error } = await supabase.rpc("admin_set_listing_status", {
            p_listing_id: action.id,
            p_status: "Available",
            p_reason: r ?? "Approved via compliance queue",
          });
          if (error) throw new Error(error.message);
          break;
        }
        case "suspend-listing": {
          if (!r) throw new Error("Reason required to suspend a listing");
          const { error } = await supabase.rpc("admin_set_listing_status", {
            p_listing_id: action.id,
            p_status: "Suspended",
            p_reason: r,
          });
          if (error) throw new Error(error.message);
          break;
        }
        case "approve-service-listing": {
          const { error } = await supabase.rpc("admin_set_service_listing_status", {
            p_listing_id: action.id,
            p_status: "Available",
            p_reason: r ?? "Approved via compliance queue",
          });
          if (error) throw new Error(error.message);
          break;
        }
        case "suspend-service-listing": {
          if (!r) throw new Error("Reason required to suspend a service listing");
          const { error } = await supabase.rpc("admin_set_service_listing_status", {
            p_listing_id: action.id,
            p_status: "Suspended",
            p_reason: r,
          });
          if (error) throw new Error(error.message);
          break;
        }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["compliance"] });
      setAction(null);
      setReason("");
      setActionError(null);
    },
    onError: (err: Error) => setActionError(err.message),
  });

  // ── Derived state ─────────────────────────────────────────────────────────

  const totalPending =
    (companiesQ.data?.length ?? 0) +
    (certsQ.data?.length ?? 0) +
    (listingsQ.data?.length ?? 0) +
    (serviceListingsQ.data?.length ?? 0) +
    (disputesQ.data?.length ?? 0);

  const TABS: {
    id: Tab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count: number;
  }[] = [
    { id: "companies",        label: "Companies",        icon: Building2,     count: companiesQ.data?.length ?? 0 },
    { id: "certifications",   label: "Certifications",   icon: Award,         count: certsQ.data?.length ?? 0 },
    { id: "listings",         label: "Warehouses",       icon: Warehouse,     count: listingsQ.data?.length ?? 0 },
    { id: "service-listings", label: "Services",         icon: Wrench,        count: serviceListingsQ.data?.length ?? 0 },
    { id: "disputes",         label: "Disputes",         icon: AlertTriangle, count: disputesQ.data?.length ?? 0 },
  ];

  const isLoading =
    companiesQ.isLoading ||
    certsQ.isLoading ||
    listingsQ.isLoading ||
    serviceListingsQ.isLoading ||
    disputesQ.isLoading;

  const refetchAll = () => {
    void companiesQ.refetch();
    void certsQ.refetch();
    void listingsQ.refetch();
    void serviceListingsQ.refetch();
    void disputesQ.refetch();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-primary" />
            Compliance Queue
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalPending > 0 ? (
              <span className="text-amber-600 font-medium">
                {totalPending} item{totalPending !== 1 ? "s" : ""} pending admin action
              </span>
            ) : isLoading ? (
              "Loading…"
            ) : (
              <span className="text-green-600 font-medium">All clear — no pending items</span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refetchAll} disabled={isLoading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`relative flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
              tab === id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {count > 0 && (
              <Badge
                variant={tab === id ? "default" : "secondary"}
                className="ml-1 h-4.5 min-w-[1.25rem] px-1 text-[10px]"
              >
                {count}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {/* ── Companies Tab ───────────────────────────────────────────────── */}
      {tab === "companies" && (
        <div className="space-y-3">
          {companiesQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (companiesQ.data ?? []).length === 0 ? (
            <EmptyState icon={Building2} message="No companies pending approval" />
          ) : (
            (companiesQ.data ?? []).map((c) => (
              <Card key={c.id}>
                <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{c.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {c.type.replace(/([A-Z])/g, " $1").trim()} · {c.city ?? "Unknown city"} · Registered {formatDate(c.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:bg-destructive/10 border-destructive/40"
                      onClick={() => setAction({ kind: "suspend-company", id: c.id, name: c.name })}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setAction({ kind: "approve-company", id: c.id, name: c.name })}
                    >
                      <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* ── Certifications Tab ──────────────────────────────────────────── */}
      {tab === "certifications" && (
        <div className="space-y-3">
          {certsQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (certsQ.data ?? []).length === 0 ? (
            <EmptyState icon={Award} message="No certifications pending review" />
          ) : (
            (certsQ.data ?? []).map((c) => (
              <Card key={c.id}>
                <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{c.type}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.worker_name ?? "Unknown worker"}{c.worker_email ? ` · ${c.worker_email}` : ""} ·{" "}
                      Expires {c.expiry_date ?? "N/A"} · Submitted {formatDate(c.created_at)}
                    </p>
                    {c.file_path && (
                      <button
                        type="button"
                        onClick={() => void openCertFile(c.id, c.file_path!)}
                        disabled={fileLoadingId === c.id}
                        className="text-xs text-primary hover:underline flex items-center gap-1 mt-1 disabled:opacity-60"
                      >
                        {fileLoadingId === c.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <FileSearch className="h-3 w-3" />
                        )}
                        {fileLoadingId === c.id ? "Opening…" : "Preview certificate file"}
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:bg-destructive/10 border-destructive/40"
                      onClick={() =>
                        setAction({
                          kind: "reject-cert",
                          id: c.id,
                          workerName: c.worker_name ?? "Worker",
                          certType: c.type,
                        })
                      }
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        setAction({
                          kind: "approve-cert",
                          id: c.id,
                          workerName: c.worker_name ?? "Worker",
                          certType: c.type,
                        })
                      }
                    >
                      <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* ── Warehouse Listings Tab ───────────────────────────────────────── */}
      {tab === "listings" && (
        <div className="space-y-3">
          {listingsQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (listingsQ.data ?? []).length === 0 ? (
            <EmptyState icon={Warehouse} message="No warehouse listings pending approval" />
          ) : (
            (listingsQ.data ?? []).map((l) => (
              <Card key={l.id}>
                <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{l.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.company_name ?? "Unknown company"} · {l.warehouse_type} ·{" "}
                      {l.city ?? "Unknown city"} · Submitted {formatDate(l.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:bg-destructive/10 border-destructive/40"
                      onClick={() => setAction({ kind: "suspend-listing", id: l.id, name: l.name })}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setAction({ kind: "approve-listing", id: l.id, name: l.name })}
                    >
                      <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* ── Service Listings Tab ─────────────────────────────────────────── */}
      {tab === "service-listings" && (
        <div className="space-y-3">
          {serviceListingsQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (serviceListingsQ.data ?? []).length === 0 ? (
            <EmptyState icon={Wrench} message="No service listings pending approval" />
          ) : (
            (serviceListingsQ.data ?? []).map((s) => (
              <Card key={s.id}>
                <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{s.category}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.company_name ?? "Unknown company"}
                      {s.coverage_area && s.coverage_area.length > 0
                        ? ` · Coverage: ${s.coverage_area.slice(0, 3).join(", ")}${s.coverage_area.length > 3 ? " +more" : ""}`
                        : ""}
                      {" · Submitted "}{formatDate(s.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:bg-destructive/10 border-destructive/40"
                      onClick={() =>
                        setAction({ kind: "suspend-service-listing", id: s.id, name: s.category })
                      }
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        setAction({ kind: "approve-service-listing", id: s.id, name: s.category })
                      }
                    >
                      <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* ── Disputes Tab ────────────────────────────────────────────────── */}
      {tab === "disputes" && (
        <div className="space-y-3">
          {disputesQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (disputesQ.data ?? []).length === 0 ? (
            <EmptyState icon={AlertTriangle} message="No open disputes" />
          ) : (
            <>
              <Card className="bg-muted/40 border-dashed">
                <CardContent className="py-3 flex items-center gap-3">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    Dispute resolution is handled on the{" "}
                    <Link href="/admin/disputes" className="text-primary hover:underline font-medium">
                      Disputes page
                    </Link>
                    . The items below are shown here for visibility only.
                  </p>
                </CardContent>
              </Card>
              {(disputesQ.data ?? []).map((d) => (
                <Card key={d.id}>
                  <CardContent className="py-4 flex flex-col sm:flex-row sm:items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant={d.status === "UnderReview" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {d.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {d.opener_name ?? "Unknown"} · {formatDate(d.created_at)}
                        </span>
                      </div>
                      <p className="text-sm line-clamp-2 text-muted-foreground">{d.description}</p>
                    </div>
                    <Button size="sm" variant="outline" asChild className="shrink-0">
                      <Link href="/admin/disputes">
                        <ExternalLink className="h-3.5 w-3.5 mr-1" /> Resolve
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Summary Stats ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Queue Summary</CardTitle>
          <CardDescription>Items requiring admin action across all categories</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {TABS.map(({ id, label, icon: Icon, count }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className="flex flex-col items-center gap-1.5 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
              >
                <Icon className={`h-5 w-5 ${count > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
                <span className={`text-xl font-bold tabular-nums ${count > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                  {count}
                </span>
                <span className="text-xs text-muted-foreground text-center">{label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Action Dialog ───────────────────────────────────────────────── */}
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) { setAction(null); setReason(""); setActionError(null); }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{action ? actionTitle(action) : ""}</DialogTitle>
            <DialogDescription>
              {action && reasonRequired(action)
                ? "A reason is required for this action. It will be recorded in the audit log."
                : "This action will be recorded in the audit log."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="reason" className="text-sm">
                Reason {action && reasonRequired(action) ? "(required)" : "(optional)"}
              </Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Enter reason…"
                className="mt-1.5 min-h-[80px]"
                autoFocus
              />
            </div>
            {actionError && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                {actionError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setAction(null); setReason(""); setActionError(null); }}
              disabled={executeMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => executeMutation.mutate()}
              disabled={
                executeMutation.isPending ||
                (action !== null && reasonRequired(action) && !reason.trim())
              }
              variant={
                action?.kind.includes("reject") || action?.kind.includes("suspend")
                  ? "destructive"
                  : "default"
              }
            >
              {executeMutation.isPending ? "Processing…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── EmptyState ──────────────────────────────────────────────────────────────

function EmptyState({
  icon: Icon,
  message,
}: {
  icon: React.ComponentType<{ className?: string }>;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <div className="rounded-full bg-muted p-3">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{message}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          New items will appear here when they require review.
        </p>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-green-600">
        <CheckCircle className="h-3.5 w-3.5" />
        All clear
      </div>
    </div>
  );
}
