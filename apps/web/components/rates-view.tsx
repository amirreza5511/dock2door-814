"use client";

import { useMemo, useState } from "react";
import { DollarSign, Layers, MapPin, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  useZones,
  useRateCards,
  useUpsertZone,
  useDeleteZone,
  useUpsertRateCard,
  useDeleteRateCard,
  useSetZoneRate,
  type Accessorial,
  type RateCard,
  type VerticalConfig,
} from "@/lib/hooks/use-pricing";

function num(v: string): number {
  const n = Number(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function typeSuffix(t: Accessorial["type"]): string {
  return t === "pct" ? "%" : t === "perHour" ? "/hr" : t === "perUnit" ? "/unit" : "flat";
}

export function RatesView({
  companyId,
  config,
  roleLabel,
}: {
  companyId: string | null;
  config: VerticalConfig;
  roleLabel: string;
}) {
  const vertical = config.vertical;
  const zonesQ = useZones(companyId, vertical);
  const cardsQ = useRateCards(companyId, vertical);
  const upsertZone = useUpsertZone(companyId, vertical);
  const deleteZone = useDeleteZone(companyId, vertical);
  const upsertCard = useUpsertRateCard(companyId, vertical);
  const deleteCard = useDeleteRateCard(companyId, vertical);
  const setZoneRate = useSetZoneRate(companyId, vertical);

  const zones = useMemo(() => zonesQ.data ?? [], [zonesQ.data]);
  const cards = useMemo(() => cardsQ.data ?? [], [cardsQ.data]);

  const [zoneModal, setZoneModal] = useState<{ id?: string; name: string; description: string } | null>(null);
  const [cardModal, setCardModal] = useState<RateCard | null>(null);

  const addCard = () => {
    upsertCard.mutate({
      name: "Published rates",
      customerCompanyId: null,
      isDefault: cards.length === 0,
      baseUnit: config.baseUnit,
      accessorials: config.defaultAccessorials,
    });
  };

  const saveZone = () => {
    if (!zoneModal?.name.trim()) return;
    upsertZone.mutate(
      { id: zoneModal.id ?? null, name: zoneModal.name, description: zoneModal.description },
      { onSuccess: () => setZoneModal(null) },
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">{roleLabel}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{config.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{config.subtitle}</p>
      </div>

      {/* Zones */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">{config.zoneLabelPlural}</h2>
          </div>
          <Button size="sm" variant="outline" onClick={() => setZoneModal({ name: "", description: "" })}>
            <Plus className="mr-1.5 h-4 w-4" /> Add {config.zoneLabel.toLowerCase()}
          </Button>
        </div>
        {zones.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">{config.zoneHint}</CardContent>
          </Card>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {zones.map((z) => (
              <Card key={z.id}>
                <CardContent className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{z.name}</p>
                    {z.description ? (
                      <p className="truncate text-xs text-muted-foreground">{z.description}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setZoneModal({ id: z.id, name: z.name, description: z.description ?? "" })}>
                      <DollarSign className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteZone.mutate(z.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Rate cards */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Rate cards</h2>
          </div>
          <Button size="sm" variant="outline" onClick={addCard}>
            <Plus className="mr-1.5 h-4 w-4" /> Add rate card
          </Button>
        </div>
        {cards.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Create a rate card to publish your {config.baseUnit} pricing.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {cards.map((card) => (
              <Card key={card.id}>
                <CardContent className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{card.name}</p>
                      {card.is_default ? <Badge variant="secondary">Default</Badge> : null}
                      {card.customer?.name ? <Badge variant="outline">{card.customer.name}</Badge> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {card.currency} · {card.base_unit || config.baseUnit} · {(card.accessorials?.length ?? 0)} add-ons
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setCardModal(card)}>
                      Edit rates
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteCard.mutate(card.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Zone modal */}
      <Dialog open={!!zoneModal} onOpenChange={(o) => !o && setZoneModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{zoneModal?.id ? "Edit" : "Add"} {config.zoneLabel.toLowerCase()}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={zoneModal?.name ?? ""}
                placeholder={config.zonePlaceholder}
                onChange={(e) => setZoneModal((m) => (m ? { ...m, name: e.target.value } : m))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Input
                value={zoneModal?.description ?? ""}
                onChange={(e) => setZoneModal((m) => (m ? { ...m, description: e.target.value } : m))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setZoneModal(null)}>
              Cancel
            </Button>
            <Button onClick={saveZone} disabled={upsertZone.isPending}>
              {upsertZone.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Card rates modal */}
      <Dialog open={!!cardModal} onOpenChange={(o) => !o && setCardModal(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{cardModal?.name}</DialogTitle>
          </DialogHeader>
          {cardModal ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Base rate per {config.zoneLabel.toLowerCase()} ({cardModal.base_unit || config.baseUnit})
                </p>
                {zones.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Add {config.zoneLabelPlural.toLowerCase()} first to price them.</p>
                ) : (
                  zones.map((z) => {
                    const zr = (cardModal.provider_zone_rates ?? []).find((r) => r.zone_id === z.id);
                    return (
                      <div key={z.id} className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm">{z.name}</span>
                        <Input
                          className="w-28"
                          defaultValue={zr ? String(zr.base_rate) : ""}
                          placeholder="0.00"
                          onBlur={(e) =>
                            setZoneRate.mutate({ rateCardId: cardModal.id, zoneId: z.id, baseRate: num(e.target.value) })
                          }
                        />
                      </div>
                    );
                  })
                )}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Add-ons</p>
                {(cardModal.accessorials ?? []).map((a, i) => (
                  <div key={a.key} className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm">
                      {a.label} <span className="text-xs text-muted-foreground">({typeSuffix(a.type)})</span>
                    </span>
                    <Input
                      className="w-28"
                      defaultValue={a.amount ? String(a.amount) : ""}
                      placeholder="0"
                      onBlur={(e) => {
                        const next = [...(cardModal.accessorials ?? [])];
                        next[i] = { ...a, amount: num(e.target.value) };
                        upsertCard.mutate({ id: cardModal.id, name: cardModal.name, accessorials: next });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setCardModal(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
