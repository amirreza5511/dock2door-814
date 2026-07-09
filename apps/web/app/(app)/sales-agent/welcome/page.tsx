"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, UserPlus, HandHeart, Wallet, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export const WELCOME_SEEN_KEY = "d2d.sales.welcomeSeen";

interface Slide {
  icon: React.ReactNode;
  tint: string;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    icon: <Sparkles className="h-8 w-8 text-primary" />,
    tint: "bg-primary/15",
    title: "Welcome, Sales Agent",
    body: "You're the bridge between businesses and Dock2Door. You bring warehouses, carriers, employers and more onto the platform — and earn commission on every one you sign.",
  },
  {
    icon: <UserPlus className="h-8 w-8 text-blue-400" />,
    tint: "bg-blue-500/15",
    title: "Onboard a business",
    body: "Share your personal invite link. When a business signs up with it, they're automatically credited to you and appear in your client book — no paperwork, no manual steps.",
  },
  {
    icon: <HandHeart className="h-8 w-8 text-purple-400" />,
    tint: "bg-purple-500/15",
    title: "Help them get set up",
    body: "Track each client through onboarding — signed up, setting up, active. Nudge them along and keep every relationship in one place.",
  },
  {
    icon: <Wallet className="h-8 w-8 text-emerald-400" />,
    tint: "bg-emerald-500/15",
    title: "Get paid",
    body: "Earn a signing bounty for each account plus recurring commission on the revenue they generate. Watch it all stack up in your ledger.",
  },
];

export default function SalesAgentWelcomePage() {
  const router = useRouter();
  const [index, setIndex] = useState<number>(0);

  const finish = useCallback(
    (target: "onboard" | "home") => {
      try {
        window.localStorage.setItem(WELCOME_SEEN_KEY, "1");
      } catch {}
      router.replace(target === "onboard" ? "/sales-agent/onboard" : "/sales-agent");
    },
    [router],
  );

  const isLast = useMemo(() => index === SLIDES.length - 1, [index]);
  const slide = SLIDES[index];

  return (
    <div className="relative mx-auto flex min-h-[calc(100vh-8rem)] max-w-2xl flex-col overflow-hidden rounded-2xl border bg-gradient-to-b from-[#12253D] to-background">
      <div className="flex justify-end p-4">
        <button
          onClick={() => finish("home")}
          className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent"
        >
          Skip <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <div className={`grid h-20 w-20 place-items-center rounded-3xl ${slide.tint}`}>{slide.icon}</div>
        <p className="text-xs font-extrabold uppercase tracking-[0.15em] text-primary">
          Step {index + 1} of {SLIDES.length}
        </p>
        <h1 className="text-3xl font-bold tracking-tight">{slide.title}</h1>
        <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">{slide.body}</p>
      </div>

      <div className="flex flex-col items-center gap-5 px-8 pb-10 pt-4">
        <div className="flex items-center gap-2">
          {SLIDES.map((_, i) => (
            <span
              key={i}
              className={`h-2 rounded-full transition-all ${i === index ? "w-6 bg-primary" : "w-2 bg-border"}`}
            />
          ))}
        </div>
        <Button
          size="lg"
          className="w-full max-w-md"
          onClick={() => (isLast ? finish("onboard") : setIndex((i) => Math.min(SLIDES.length - 1, i + 1)))}
        >
          {isLast ? <UserPlus className="mr-2 h-4 w-4" /> : null}
          {isLast ? "Onboard your first client" : "Continue"}
          {!isLast ? <ChevronRight className="ml-2 h-4 w-4" /> : null}
        </Button>
        {isLast ? (
          <button onClick={() => finish("home")} className="text-sm font-semibold text-muted-foreground hover:text-foreground">
            I&apos;ll explore on my own
          </button>
        ) : null}
      </div>
    </div>
  );
}
