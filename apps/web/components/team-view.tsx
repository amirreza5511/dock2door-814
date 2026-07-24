"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, UserMinus, ShieldCheck, Pencil, Pause, Play, Search } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { useMyCompanies } from "@/lib/hooks/use-active-company";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useExplore, useActionGuard } from "@/lib/explore-store";

const SAMPLE_TEAM: MemberRow[] = [
  { id: "ex-tm-1", user_id: "ex-u-1", company_role: "Owner", status: "Active", profiles: { id: "ex-u-1", name: "Alex Morgan", email: "alex@previewco.com", role: "employer" } },
  { id: "ex-tm-2", user_id: "ex-u-2", company_role: "Manager", status: "Active", profiles: { id: "ex-u-2", name: "Priya Sharma", email: "priya@previewco.com", role: "employer" } },
  { id: "ex-tm-3", user_id: "ex-u-3", company_role: "Supervisor", status: "Active", profiles: { id: "ex-u-3", name: "Marcus Lee", email: "marcus@previewco.com", role: "employer" } },
  { id: "ex-tm-4", user_id: "ex-u-4", company_role: "Staff", status: "Suspended", profiles: { id: "ex-u-4", name: "Dan Kowalski", email: "dan@previewco.com", role: "employer" } },
];

/** Company roles offered to every company type. Mirrors GENERIC_COMPANY_ROLES on mobile. */
export const GENERIC_COMPANY_ROLES = ["Owner", "Manager", "Supervisor", "Staff", "ReadOnly"] as const;
export const WAREHOUSE_COMPANY_ROLES = [
  "Owner", "Manager", "Supervisor", "Receiver", "Picker", "Packer",
  "ShippingClerk", "InventoryClerk", "DockStaff", "ReadOnly",
] as const;

export type CompanyRole = string;

const ROLE_LABEL: Record<string, string> = {
  Owner: "Owner",
  Manager: "Manager",
  Supervisor: "Supervisor",
  Staff: "Staff",
  ReadOnly: "Read only",
  Receiver: "Receiver",
  Picker: "Picker",
  Packer: "Packer",
  ShippingClerk: "Shipping clerk",
  InventoryClerk: "Inventory clerk",
  DockStaff: "Dock staff",
};

const ROLE_DESCRIPTION: Record<string, string> = {
  Manager: "Full operational control except ownership transfer.",
  Supervisor: "Oversees day-to-day work and approves entries.",
  Staff: "Handles assigned operational tasks.",
  ReadOnly: "View-only access to company data.",
  Receiver: "Inbound receiving and put-away.",
  Picker: "Order picking from locations.",
  Packer: "Packing and outbound prep.",
  ShippingClerk: "Manifests and carrier hand-off.",
  InventoryClerk: "Cycle counts and adjustments.",
  DockStaff: "Gate and dock movements.",
};

function label(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

interface MemberRow {
  id: string;
  user_id: string;
  company_role: string;
  status: string;
  profiles: { id: string; name: string; email: string; role: string } | null;
}

interface TeamViewProps {
  title?: string;
  subtitle?: string;
  companyType?: string;
  roleOptions?: readonly string[];
  defaultRole?: string;
}

/**
 * Reusable web team / staff management surface. Backed by the generic
 * `company_users` table + `company_*` RPCs — identical data layer to the
 * mobile TeamManagement. Owners and Managers can invite members, change roles,
 * suspend, reactivate and remove.
 */
export function TeamView({
  title = "Team",
  subtitle,
  companyType,
  roleOptions = GENERIC_COMPANY_ROLES,
  defaultRole,
}: TeamViewProps) {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const { isExploring } = useExplore();
  const guard = useActionGuard();
  const companies = useMyCompanies();
  const active = useMemo(() => {
    const list = companies.data ?? [];
    if (companyType) return list.find((c) => c.company_type === companyType) ?? list[0];
    return list[0];
  }, [companies.data, companyType]);
  const companyId = isExploring ? "explore-company" : (active?.company_id ?? null);
  const myRole = isExploring ? "Owner" : (active?.role ?? null);
  const canManage = myRole === "Owner" || myRole === "Manager";

  const inviteRoles = useMemo(() => roleOptions.filter((r) => r !== "Owner"), [roleOptions]);
  const initialRole = defaultRole && inviteRoles.includes(defaultRole) ? defaultRole : (inviteRoles[0] ?? "Staff");

  const membersQuery = useQuery({
    queryKey: ["company", "members", companyId],
    enabled: Boolean(companyId) && !isExploring,
    queryFn: async (): Promise<MemberRow[]> => {
      const { data, error } = await supabase
        .from("company_users")
        .select("id,user_id,company_role,status,profiles(id,name,email,role)")
        .eq("company_id", companyId as string);
      if (error) throw error;
      return (data as unknown as MemberRow[] | null) ?? [];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["company", "members", companyId] });

  const addM = useMutation({
    mutationFn: async (v: { userId: string; role: string }) => {
      const { error: e2 } = await supabase.rpc("company_add_member_v2", {
        p_company_id: companyId, p_user_id: v.userId, p_role: v.role, p_reason: null,
      });
      if (e2) {
        const { error } = await supabase.rpc("company_add_member", {
          p_company_id: companyId, p_user_id: v.userId, p_role: v.role,
        });
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });
  const updateRoleM = useMutation({
    mutationFn: async (v: { userId: string; role: string }) => {
      const { error } = await supabase.rpc("company_update_member_role", {
        p_company_id: companyId, p_user_id: v.userId, p_role: v.role, p_reason: "Role changed by owner/manager",
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const setStatusM = useMutation({
    mutationFn: async (v: { userId: string; status: "Active" | "Suspended" | "Inactive" }) => {
      const { error } = await supabase.rpc("company_set_member_status", {
        p_company_id: companyId, p_user_id: v.userId, p_status: v.status, p_reason: null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const removeM = useMutation({
    mutationFn: async (v: { userId: string }) => {
      const { error } = await supabase.rpc("company_remove_member", {
        p_company_id: companyId, p_user_id: v.userId, p_reason: "Removed by owner/manager",
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const [search, setSearch] = useState<string>("");
  const [filterRole, setFilterRole] = useState<string>("All");
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [email, setEmail] = useState<string>("");
  const [role, setRole] = useState<string>(initialRole);
  const [findErr, setFindErr] = useState<string>("");
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [editRole, setEditRole] = useState<string>(initialRole);

  const members = isExploring ? SAMPLE_TEAM : (membersQuery.data ?? []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (filterRole !== "All" && m.company_role !== filterRole) return false;
      if (!q) return true;
      const hay = `${m.profiles?.name ?? ""} ${m.profiles?.email ?? ""} ${m.user_id}`.toLowerCase();
      return hay.includes(q);
    });
  }, [members, search, filterRole]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: members.length };
    for (const m of members) c[m.company_role] = (c[m.company_role] ?? 0) + 1;
    return c;
  }, [members]);

  const handleAdd = async () => {
    if (!guard("Invite a team member")) return;
    setFindErr("");
    const clean = email.trim().toLowerCase();
    if (!clean) { setFindErr("Enter a user email."); return; }
    try {
      const { data: user } = await supabase.from("profiles").select("id,name,email").eq("email", clean).maybeSingle();
      if (!user) { setFindErr("User not found. Ask them to sign up first, then add them here."); return; }
      await addM.mutateAsync({ userId: (user as { id: string }).id, role });
      setEmail("");
      setAddOpen(false);
    } catch (e) {
      setFindErr(e instanceof Error ? e.message : "Unable to add member.");
    }
  };

  const handleSaveRole = async () => {
    if (!guard("Change a member's role")) return;
    if (!editing) return;
    try {
      await updateRoleM.mutateAsync({ userId: editing.user_id, role: editRole });
      setEditing(null);
    } catch {
      /* surfaced via mutation error below if needed */
    }
  };

  if (!isExploring && companies.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No active company</CardTitle>
          <CardDescription>You are not a member of a company yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const filterChips = ["All", ...roleOptions];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {subtitle ?? `${members.length} member${members.length === 1 ? "" : "s"} · ${active?.company_name ?? ""}`}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => { setRole(initialRole); setFindErr(""); setAddOpen(true); }}>
            <UserPlus className="h-4 w-4" /> Invite
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filterChips.map((r) => (
            <button
              key={r}
              onClick={() => setFilterRole(r)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                filterRole === r ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {r === "All" ? "All" : label(r)} · {counts[r] ?? 0}
            </button>
          ))}
        </div>
      </div>

      {!canManage && (
        <Card>
          <CardContent className="py-3 text-sm text-muted-foreground">
            You have view-only access to the team. Only an Owner or Manager can invite or change roles.
          </CardContent>
        </Card>
      )}

      {!isExploring && membersQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading members…</p>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No members match your filter.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((m) => (
            <Card key={m.id}>
              <CardContent className="flex items-center gap-4 py-4">
                <div className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-bold",
                  m.company_role === "Owner" ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted",
                )}>
                  {(m.profiles?.name ?? "?").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{m.profiles?.name ?? m.user_id}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.profiles?.email ?? "—"}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Badge variant={m.company_role === "Owner" ? "default" : "outline"} className="gap-1">
                      {m.company_role === "Owner" && <ShieldCheck className="h-3 w-3" />}
                      {label(m.company_role)}
                    </Badge>
                    <Badge variant={m.status === "Active" ? "success" : m.status === "Suspended" ? "warning" : "secondary"}>
                      {m.status}
                    </Badge>
                  </div>
                </div>
                {canManage && m.company_role !== "Owner" && (
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="icon" variant="outline" onClick={() => { if (!guard("Change a member's role")) return; setEditing(m); setEditRole(m.company_role); }} title="Change role">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {m.status === "Active" ? (
                      <Button size="icon" variant="outline" onClick={() => { if (!guard("Suspend a member")) return; setStatusM.mutate({ userId: m.user_id, status: "Suspended" }); }} title="Suspend">
                        <Pause className="h-4 w-4" />
                      </Button>
                    ) : m.status === "Suspended" ? (
                      <Button size="icon" variant="outline" onClick={() => { if (!guard("Reactivate a member")) return; setStatusM.mutate({ userId: m.user_id, status: "Active" }); }} title="Reactivate">
                        <Play className="h-4 w-4" />
                      </Button>
                    ) : null}
                    {m.status === "Active" && (
                      <Button size="icon" variant="outline" onClick={() => { if (!guard("Remove a member")) return; removeM.mutate({ userId: m.user_id }); }} title="Remove" className="text-destructive">
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Invite modal */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">User must already have a Dock2Door account.</p>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            type="email"
            autoCapitalize="none"
          />
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Role</p>
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {inviteRoles.map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors",
                    role === r ? "border-primary bg-primary/10" : "border-border hover:bg-accent",
                  )}
                >
                  <div className="flex-1">
                    <p className={cn("text-sm font-semibold", role === r && "text-primary")}>{label(r)}</p>
                    {ROLE_DESCRIPTION[r] && <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTION[r]}</p>}
                  </div>
                  <span className={cn("h-4 w-4 rounded-full border-2", role === r ? "border-primary bg-primary" : "border-border")} />
                </button>
              ))}
            </div>
          </div>
          {findErr && <p className="text-xs text-destructive">{findErr}</p>}
          <Button onClick={handleAdd} disabled={addM.isPending} className="w-full">
            <UserPlus className="h-4 w-4" /> Send invite
          </Button>
        </DialogContent>
      </Dialog>

      {/* Edit role modal */}
      <Dialog open={Boolean(editing)} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change role</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">{editing?.profiles?.name ?? editing?.user_id}</p>
          <div className="max-h-80 space-y-1.5 overflow-y-auto">
            {roleOptions.map((r) => (
              <button
                key={r}
                onClick={() => setEditRole(r)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors",
                  editRole === r ? "border-primary bg-primary/10" : "border-border hover:bg-accent",
                )}
              >
                <div className="flex-1">
                  <p className={cn("text-sm font-semibold", editRole === r && "text-primary")}>{label(r)}</p>
                  {ROLE_DESCRIPTION[r] && <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTION[r]}</p>}
                </div>
                <span className={cn("h-4 w-4 rounded-full border-2", editRole === r ? "border-primary bg-primary" : "border-border")} />
              </button>
            ))}
          </div>
          <Button onClick={handleSaveRole} disabled={updateRoleM.isPending} className="w-full">Save</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
