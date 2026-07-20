"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";

/**
 * Set a new password after clicking the recovery link from the reset email.
 * The Supabase browser client exchanges the recovery code in the URL for a
 * session automatically; we then just call updateUser.
 */
export default function UpdatePasswordPage() {
  const supabase = getBrowserSupabase();
  const router = useRouter();
  const [password, setPassword] = useState<string>("");
  const [confirm, setConfirm] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<boolean>(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw new Error(err.message);
      setDone(true);
      setTimeout(() => router.push("/dashboard"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update password. Open the reset link from your email again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-white/10 bg-card p-8">
        <div className="space-y-2 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Set a new password</h1>
          <p className="text-sm text-muted-foreground">Choose a new password for your Dock2Door account.</p>
        </div>

        {done ? (
          <p className="text-center text-sm text-emerald-400">Password updated — taking you to your dashboard…</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="new-password" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-background px-3 py-2.5 text-sm outline-none focus:border-primary/50"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="confirm-password" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Confirm password
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-background px-3 py-2.5 text-sm outline-none focus:border-primary/50"
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
            >
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
