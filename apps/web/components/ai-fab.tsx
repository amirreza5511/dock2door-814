"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";

/** Floating AI copilot button, visible on every authenticated page. */
export function AiFab() {
  const pathname = usePathname();
  if (pathname?.startsWith("/copilot") || pathname?.startsWith("/assistant")) return null;
  return (
    <Link
      href="/copilot"
      title="AI Copilot"
      className="fixed bottom-6 right-6 z-50 grid h-13 w-13 place-items-center rounded-full bg-primary p-3.5 text-primary-foreground shadow-lg shadow-primary/40 ring-1 ring-white/20 transition hover:scale-105 hover:shadow-primary/60"
    >
      <Sparkles className="h-5 w-5" />
    </Link>
  );
}
