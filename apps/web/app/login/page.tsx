"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const supabase = getBrowserSupabase();
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setInfo("Account created. Check your inbox if email confirmation is required, then sign in.");
        setMode("signin");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">D2</span>
            <span className="text-base font-semibold">Dock2Door</span>
          </div>
          <CardTitle>{mode === "signin" ? "Sign in" : "Create account"}</CardTitle>
          <CardDescription>
            Operations Console &middot; web panel for the Dock2Door logistics platform.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={submit}>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {info && <p className="text-sm text-emerald-600">{info}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Working…" : mode === "signin" ? "Sign in" : "Sign up"}
            </Button>
            <button
              type="button"
              className="block w-full text-center text-xs text-muted-foreground hover:underline"
              onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); setInfo(null); }}
            >
              {mode === "signin" ? "No account? Sign up" : "Already have an account? Sign in"}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
