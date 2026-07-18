"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";

interface ClientRow {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  status: string;
  created_at: string;
}

export default function AgencyClientsPage() {
  const supabase = getBrowserSupabase();
  const qc = useQueryClient();
  const companyId = useActiveCompanyId("EmploymentAgency");

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");

  const q = useQuery({
    queryKey: ["agency", "clients", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<ClientRow[]> => {
      const { data, error } = await supabase
        .from("agency_clients")
        .select("*")
        .eq("agency_company_id", companyId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as ClientRow[] | null) ?? [];
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("agency_clients").insert({
        agency_company_id: companyId,
        name: name.trim(),
        contact_name: contactName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        notes: notes.trim(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setOpen(false);
      setName(""); setContactName(""); setEmail(""); setPhone(""); setAddress(""); setNotes(""); setFormError("");
      void qc.invalidateQueries({ queryKey: ["agency", "clients"] });
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("agency_clients")
        .update({ status })
        .eq("id", id)
        .eq("agency_company_id", companyId as string);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["agency", "clients"] }),
  });

  const rows = q.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Employment Agency</p>
          <h1 className="text-2xl font-semibold tracking-tight">My clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your own customer book — companies you staff outside of Dock2Door&apos;s open shift board.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Add client</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Clients ({rows.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Building2 className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No clients yet. Keep your own customer book here.</p>
            </div>
          ) : (
            rows.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-card/60 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.contact_name || "No contact"}{c.email ? ` · ${c.email}` : ""}{c.phone ? ` · ${c.phone}` : ""}
                  </p>
                  {c.notes ? <p className="mt-0.5 text-xs text-muted-foreground">{c.notes}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={c.status === "Active" ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-muted-foreground"}>{c.status}</Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => statusMutation.mutate({ id: c.id, status: c.status === "Active" ? "Inactive" : "Active" })}
                  >
                    {c.status === "Active" ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add a client</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Company name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fraser Foods Ltd." /></div>
            <div className="space-y-1.5"><Label>Contact person</Label><Input value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label>Address</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} /></div>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!name.trim() || addMutation.isPending} onClick={() => addMutation.mutate()}>
              {addMutation.isPending ? "Adding…" : "Add client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
