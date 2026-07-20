"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, ShieldCheck, Wallet } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useActiveCompanyId } from "@/lib/hooks/use-active-company";

interface CompanyRow {
  id: string;
  name: string;
  stripe_connect_account_id: string | null;
  stripe_connect_onboarded: boolean | null;
}

/** Stripe Connect payout setup — mirrors the mobile warehouse-provider/stripe-connect screen. */
export default function StripeConnectPage() {
  const supabase = getBrowserSupabase();
  const companyId = useActiveCompanyId();
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const companyQ = useQuery({
    queryKey: ["stripe-connect", "company", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<CompanyRow | null> => {
      if (!companyId) return null;
      const { data, error: err } = await supabase
        .from("companies")
        .select("id, name, stripe_connect_account_id, stripe_connect_onboarded")
        .eq("id", companyId)
        .maybeSingle();
      if (err) throw err;
      return (data ?? null) as CompanyRow | null;
    },
  });

  const onboard = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("No active company");
      const returnUrl = `${window.location.origin}/warehouse/stripe-connect`;
      const { data, error: err } = await supabase.functions.invoke("stripe-connect-onboard", {
        body: { company_id: companyId, return_url: returnUrl, refresh_url: returnUrl },
      });
      if (err) throw new Error(err.message);
      return data as { url: string | null; account_id: string; onboarded: boolean };
    },
    onSuccess: async (res) => {
      setError(null);
      await companyQ.refetch();
      if (res.onboarded) return;
      if (res.url) {
        setLastUrl(res.url);
        window.open(res.url, "_blank");
      }
    },
    onError: (e: Error) => setError(`Unable to start onboarding: ${e.message}`),
  });

  const dashboard = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("No active company");
      const { data, error: err } = await supabase.functions.invoke("stripe-connect-dashboard", {
        body: { company_id: companyId },
      });
      if (err) throw new Error(err.message);
      return data as { url: string; account_id: string };
    },
    onSuccess: (res) => {
      setError(null);
      if (res.url) window.open(res.url, "_blank");
    },
    onError: async (e: Error) => {
      if (e.message.toLowerCase().includes("onboarding_incomplete")) await companyQ.refetch();
      setError(`Unable to open Stripe dashboard: ${e.message}`);
    },
  });

  const state = useMemo<"none" | "pending" | "ready">(() => {
    const c = companyQ.data;
    if (!c?.stripe_connect_account_id) return "none";
    return c.stripe_connect_onboarded ? "ready" : "pending";
  }, [companyQ.data]);

  if (!companyId) {
    return <p className="py-20 text-center text-sm text-muted-foreground">Select an active company first.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payout setup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dock2Door pays you via Stripe Connect after commission is deducted. Complete onboarding to receive transfers.
        </p>
      </div>

      {error && (
        <Card className="border-red-500/40">
          <CardContent className="pt-6 text-sm text-red-400">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-start gap-3">
            <div
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${
                state === "ready" ? "bg-emerald-500/15" : state === "pending" ? "bg-yellow-500/15" : "bg-muted"
              }`}
            >
              {state === "ready" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              ) : (
                <Wallet className={`h-5 w-5 ${state === "pending" ? "text-yellow-400" : "text-muted-foreground"}`} />
              )}
            </div>
            <div>
              <p className="font-semibold">
                {state === "ready" ? "Payouts enabled" : state === "pending" ? "Onboarding in progress" : "Not connected"}
              </p>
              <p className="text-sm text-muted-foreground">
                {state === "ready"
                  ? "You will receive transfers automatically after each paid booking."
                  : state === "pending"
                    ? "Your Stripe account is created but onboarding needs to be finished."
                    : "Connect a Stripe account to start receiving payouts."}
              </p>
            </div>
          </div>

          {companyQ.data?.stripe_connect_account_id && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-xs">
              <span className="font-medium text-muted-foreground">Stripe account</span>
              <span className="truncate font-mono">{companyQ.data.stripe_connect_account_id}</span>
            </div>
          )}

          <div className="space-y-2">
            {state === "ready" ? (
              <>
                <Button className="w-full" onClick={() => dashboard.mutate()} disabled={dashboard.isPending}>
                  <ExternalLink className="mr-2 h-4 w-4" /> Open Stripe dashboard
                </Button>
                <Button className="w-full" variant="secondary" onClick={() => onboard.mutate()} disabled={onboard.isPending}>
                  <ShieldCheck className="mr-2 h-4 w-4" /> Refresh status
                </Button>
              </>
            ) : (
              <Button className="w-full" onClick={() => onboard.mutate()} disabled={onboard.isPending}>
                <ShieldCheck className="mr-2 h-4 w-4" />
                {onboard.isPending ? "Working…" : state === "none" ? "Start Stripe onboarding" : "Continue onboarding"}
              </Button>
            )}
            {lastUrl && state !== "ready" && (
              <Button className="w-full" variant="secondary" onClick={() => window.open(lastUrl, "_blank")}>
                <ExternalLink className="mr-2 h-4 w-4" /> Re-open onboarding link
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="font-semibold">How it works</p>
          <InfoRow n={1} text="Dock2Door collects payment from the customer on your behalf." />
          <InfoRow n={2} text="Platform commission is deducted per the active commission rule." />
          <InfoRow n={3} text="The remaining amount is queued as a payout and transferred to your connected Stripe account." />
          <InfoRow n={4} text="Stripe deposits funds to your bank on your configured schedule." />
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-5.5 w-5.5 shrink-0 place-items-center rounded-full bg-primary/15 px-2 text-xs font-bold text-primary">{n}</span>
      <p className="text-sm leading-relaxed">{text}</p>
    </div>
  );
}
