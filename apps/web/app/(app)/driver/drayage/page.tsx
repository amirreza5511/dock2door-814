"use client";

import { useMemo, useState } from "react";
import { Anchor, Ship, ChevronRight, Loader2, Users, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import {
  useDriverWorkOrders,
  useAdvanceMove,
  useJoinFleet,
  MOVE_NEXT,
  type WorkOrder,
} from "@/lib/hooks/use-drayage-driver";

const ACTIVE = ["EnRoute", "AtOrigin", "Loaded", "InTransit", "AtDestination", "Unloaded"];

function statusVariant(s: string): "default" | "secondary" | "outline" {
  if (s === "Completed") return "default";
  if (ACTIVE.includes(s)) return "secondary";
  return "outline";
}

export default function DriverDrayagePage() {
  const q = useDriverWorkOrders();
  const advance = useAdvanceMove();
  const joinFleet = useJoinFleet();

  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [receiverOrder, setReceiverOrder] = useState<{ order: WorkOrder; nextStatus: string } | null>(null);
  const [receiverName, setReceiverName] = useState("");
  const [condition, setCondition] = useState<"Good" | "Damaged">("Good");
  const [damageNotes, setDamageNotes] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mtOrder, setMtOrder] = useState<WorkOrder | null>(null);
  const [mtNumber, setMtNumber] = useState("");
  const [mtBusy, setMtBusy] = useState(false);
  const supabase = getBrowserSupabase();

  const orders = useMemo<WorkOrder[]>(() => q.data ?? [], [q.data]);

  const groups = useMemo(() => {
    const active: WorkOrder[] = [];
    const upcoming: WorkOrder[] = [];
    const done: WorkOrder[] = [];
    for (const o of orders) {
      if (o.status === "Completed" || o.status === "Cancelled") done.push(o);
      else if (ACTIVE.includes(o.status)) active.push(o);
      else upcoming.push(o);
    }
    return { active, upcoming, done };
  }, [orders]);

  const doAdvance = async (order: WorkOrder) => {
    const next = MOVE_NEXT[order.status];
    if (!next) return;
    if (next.requiresReceiver) {
      setReceiverOrder({ order, nextStatus: next.status });
      setReceiverName("");
      return;
    }
    setBusyId(order.id);
    try {
      await advance.mutateAsync({ moveId: order.id, nextStatus: next.status });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Unable to advance move");
    } finally {
      setBusyId(null);
    }
  };

  const submitReceiver = async () => {
    if (!receiverOrder || !receiverName.trim()) return;
    setBusyId(receiverOrder.order.id);
    try {
      await advance.mutateAsync({
        moveId: receiverOrder.order.id,
        nextStatus: receiverOrder.nextStatus,
        receiverName: receiverName.trim(),
      });
      // Record the container inspection at drop.
      await supabase.rpc("record_equipment_inspection", {
        p_order_id: receiverOrder.order.order_id,
        p_equipment_type: "Container",
        p_reference: receiverOrder.order.drayage_orders?.container_number ?? "",
        p_phase: "Drop",
        p_condition: condition,
        p_damage_notes: condition === "Damaged" ? damageNotes.trim() : "",
        p_photo_paths: [],
        p_move_id: receiverOrder.order.id,
        p_inspector_role: "Driver",
      });
      setReceiverOrder(null);
      setCondition("Good");
      setDamageNotes("");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Unable to advance move");
    } finally {
      setBusyId(null);
    }
  };

  const submitMt = async () => {
    if (!mtOrder) return;
    const num = mtNumber.trim().toUpperCase();
    if (num.length < 4) { window.alert("Enter the empty container number you picked up."); return; }
    setMtBusy(true);
    try {
      const { error } = await supabase.rpc("report_empty_container", { p_order_id: mtOrder.order_id, p_container_number: num });
      if (error) throw new Error(error.message);
      await q.refetch();
      setMtOrder(null);
      setMtNumber("");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Unable to report container");
    } finally {
      setMtBusy(false);
    }
  };

  const submitJoin = async () => {
    if (joinCode.trim().length < 4) return;
    try {
      const res = await joinFleet.mutateAsync(joinCode);
      setJoinOpen(false);
      setJoinCode("");
      window.alert(`Joined ${res.companyName}. Dispatch can now assign you container moves.`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Unable to join fleet");
    }
  };

  const renderCard = (order: WorkOrder, primary: boolean) => {
    const next = MOVE_NEXT[order.status];
    const o = order.drayage_orders;
    return (
      <Card key={order.id} className={primary ? "border-primary" : undefined}>
        <CardContent className="space-y-3 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{order.move_type}</p>
              <p className="text-xs font-medium text-primary">{o?.reference_code ?? "—"}</p>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Ship className="h-3 w-3" />
                <span>{o?.container_number || "Container TBD"} · {o?.container_size ?? ""}</span>
              </div>
              {order.appt_date ? (
                <p className="mt-1 text-xs text-emerald-500">Appt: {order.appt_date} {order.appt_time ?? ""}</p>
              ) : null}
            </div>
            <Badge variant={statusVariant(order.status)}>{order.status}</Badge>
          </div>

          <div className="space-y-1.5 rounded-lg bg-muted/40 p-3">
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-blue-400" /><span className="truncate text-xs">{order.from_address ?? "Pickup"}</span></div>
            <div className="ml-1 h-3 w-px bg-border" />
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400" /><span className="truncate text-xs">{order.to_address ?? "Destination"}</span></div>
          </div>

          {o?.is_hazmat || o?.is_overweight ? (
            <div className="flex gap-2">
              {o?.is_hazmat ? <Badge variant="outline" className="text-red-500">Hazmat</Badge> : null}
              {o?.is_overweight ? <Badge variant="outline" className="text-yellow-500">Overweight</Badge> : null}
            </div>
          ) : null}

          {primary && next ? (
            <Button className="w-full" onClick={() => void doAdvance(order)} disabled={busyId === order.id}>
              {busyId === order.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {next.label}
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : null}
          {(order.move_type === "EmptyPickup" || order.move_type === "Pickup") && !o?.mt_reported_at ? (
            <Button variant="outline" className="w-full" onClick={() => { setMtOrder(order); setMtNumber(o?.container_number ?? ""); }}>
              <Package className="mr-1.5 h-4 w-4" /> Report empty container #
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  };

  const activeOrder = groups.active[0] ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Driver</p>
          <h1 className="text-2xl font-semibold tracking-tight">Drayage work orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">Container moves assigned to you by dispatch.</p>
        </div>
        <Button variant="outline" onClick={() => { setJoinCode(""); setJoinOpen(true); }}>
          <Users className="mr-1.5 h-4 w-4" /> Join a fleet
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Active", value: groups.active.length },
          { label: "Upcoming", value: groups.upcoming.length },
          { label: "Done", value: groups.done.length },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Anchor className="h-9 w-9 text-muted-foreground" />
            <p className="text-sm font-medium">No work orders yet</p>
            <p className="max-w-xs text-sm text-muted-foreground">Not seeing any moves? Make sure you've joined your drayage company's fleet with their code.</p>
            <Button variant="outline" onClick={() => { setJoinCode(""); setJoinOpen(true); }}>
              <Users className="mr-1.5 h-4 w-4" /> Join a fleet
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.active.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-primary">Now</h2>
              {groups.active.map((o) => renderCard(o, o === activeOrder))}
            </section>
          ) : null}
          {groups.upcoming.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Upcoming</h2>
              {groups.upcoming.map((o) => renderCard(o, groups.active.length === 0))}
            </section>
          ) : null}
          {groups.done.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Completed</h2>
              {groups.done.slice(0, 10).map((o) => renderCard(o, false))}
            </section>
          ) : null}
        </div>
      )}

      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join a drayage fleet</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Ask your drayage company for their fleet code, then enter it below so dispatch can assign you container moves.
            </p>
            <div className="space-y-1.5">
              <Label>Fleet code</Label>
              <Input value={joinCode} placeholder="e.g. 7KQ4MP" onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJoinOpen(false)}>Cancel</Button>
            <Button onClick={() => void submitJoin()} disabled={joinFleet.isPending || joinCode.trim().length < 4}>
              {joinFleet.isPending ? "Joining…" : "Join fleet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!mtOrder} onOpenChange={(o) => !o && setMtOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Empty container #</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Enter the empty (MT) container number you picked up. Dispatch is notified immediately.</p>
            <div className="space-y-1.5">
              <Label>Container number</Label>
              <Input value={mtNumber} placeholder="e.g. MSKU1234567" onChange={(e) => setMtNumber(e.target.value.toUpperCase())} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMtOrder(null)}>Cancel</Button>
            <Button onClick={() => void submitMt()} disabled={mtBusy || mtNumber.trim().length < 4}>{mtBusy ? "Reporting…" : "Report to dispatch"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!receiverOrder} onOpenChange={(o) => !o && setReceiverOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm delivery</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Record who received the container and its condition to mark it at destination.</p>
            <div className="space-y-1.5">
              <Label>Received by</Label>
              <Input value={receiverName} placeholder="Receiver name" onChange={(e) => setReceiverName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Container condition</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={condition === "Good" ? "default" : "outline"} onClick={() => setCondition("Good")}>Good</Button>
                <Button type="button" size="sm" variant={condition === "Damaged" ? "default" : "outline"} onClick={() => setCondition("Damaged")}>Damaged</Button>
              </div>
            </div>
            {condition === "Damaged" ? (
              <div className="space-y-1.5">
                <Label>Damage notes</Label>
                <Input value={damageNotes} placeholder="Describe the damage" onChange={(e) => setDamageNotes(e.target.value)} />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiverOrder(null)}>Cancel</Button>
            <Button onClick={() => void submitReceiver()} disabled={!receiverName.trim() || advance.isPending}>
              {advance.isPending ? "Saving…" : "Confirm delivery"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
