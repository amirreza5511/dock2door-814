import { ArrowUpRight, Newspaper } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";
import { LANDING_IMAGES } from "@/components/landing/images";

type Article = {
  tag: string;
  title: string;
  excerpt: string;
  date: string;
  read: string;
  image: string;
  featured?: boolean;
};

const ARTICLES: Article[] = [
  {
    tag: "Network",
    title: "Dock2Door crosses 3.2M shipments as drayage capacity doubles",
    excerpt:
      "Port-to-door container moves hit a new record this quarter as thousands of carriers joined the live network across North America and Asia.",
    date: "Jul 2, 2026",
    read: "4 min read",
    image: LANDING_IMAGES.port,
    featured: true,
  },
  {
    tag: "Product",
    title: "Real-time dock scheduling comes to every warehouse",
    excerpt: "Book appointments, avoid detention fees and keep trucks moving.",
    date: "Jun 24, 2026",
    read: "3 min read",
    image: LANDING_IMAGES.warehouse,
  },
  {
    tag: "Insights",
    title: "How on-demand labour is reshaping peak-season fulfillment",
    excerpt: "Flexible staffing helped 3PLs absorb a 40% volume spike.",
    date: "Jun 15, 2026",
    read: "5 min read",
    image: LANDING_IMAGES.trucks,
  },
];

/** Logistics news & insights feed. */
export function News() {
  const [featured, ...rest] = ARTICLES;

  return (
    <section id="news" className="relative scroll-mt-8 overflow-hidden py-24">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-[#2de2c7]">
              <Newspaper size={13} />
              News &amp; insights
            </span>
            <h2 className="font-display mt-5 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
              What&apos;s moving in{" "}
              <span className="gradient-text">logistics.</span>
            </h2>
          </div>
          <a
            href="#news"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-white/85 transition hover:border-white/30 hover:bg-white/10"
          >
            View all articles
            <ArrowUpRight size={16} />
          </a>
        </Reveal>

        <div className="mt-14 grid gap-6 lg:grid-cols-2">
          {/* featured */}
          <Reveal className="group">
            <a href="#news" className="block h-full overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04]">
              <div className="relative h-64 w-full overflow-hidden sm:h-80">
                {featured.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={featured.image}
                    alt=""
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                ) : (
                  <div className="h-full w-full bg-gradient-to-br from-[#0a2230] to-[#04121a]" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#04121a] via-transparent to-transparent" />
                <span className="absolute left-4 top-4 rounded-full bg-[#2de2c7] px-3 py-1 text-xs font-semibold text-[#04121a]">
                  {featured.tag}
                </span>
              </div>
              <div className="p-6">
                <h3 className="font-display text-xl font-semibold leading-snug text-white transition group-hover:text-[#2de2c7]">
                  {featured.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-white/55">{featured.excerpt}</p>
                <p className="mt-4 text-xs text-white/40">
                  {featured.date} · {featured.read}
                </p>
              </div>
            </a>
          </Reveal>

          {/* smaller stacked */}
          <div className="grid gap-6">
            {rest.map((a, i) => (
              <Reveal key={a.title} delay={i * 90} className="group">
                <a
                  href="#news"
                  className="flex h-full gap-4 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-3 transition hover:border-[#2de2c7]/30"
                >
                  <div className="relative h-28 w-32 shrink-0 overflow-hidden rounded-2xl sm:h-full sm:w-40">
                    {a.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.image}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-[#0a2230] to-[#04121a]" />
                    )}
                  </div>
                  <div className="flex flex-col justify-center py-2 pr-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#2de2c7]">
                      {a.tag}
                    </span>
                    <h3 className="font-display mt-1.5 text-base font-semibold leading-snug text-white transition group-hover:text-[#2de2c7]">
                      {a.title}
                    </h3>
                    <p className="mt-2 hidden text-sm leading-relaxed text-white/50 sm:block">
                      {a.excerpt}
                    </p>
                    <p className="mt-2 text-xs text-white/40">
                      {a.date} · {a.read}
                    </p>
                  </div>
                </a>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
