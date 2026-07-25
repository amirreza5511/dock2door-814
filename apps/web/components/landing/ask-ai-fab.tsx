"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";

/**
 * Floating "Ask AI" button on the public landing page — same guest logistics
 * assistant as the mobile app's orange sparkle FAB. No account needed.
 */
export function AskAiFab() {
  return (
    <Link
      href="/help/chat"
      title="Ask the AI logistics assistant — no account needed"
      className="fixed bottom-6 right-6 z-50 inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[#ff6a3d] to-[#f43f5e] px-5 py-3.5 font-display text-sm font-semibold text-white shadow-[0_10px_40px_-8px_rgba(244,63,94,0.7)] ring-1 ring-white/20 transition hover:scale-105"
      data-testid="landing-ai-fab"
    >
      <Sparkles size={17} />
      Ask AI
    </Link>
  );
}
