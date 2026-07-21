"use client";

import { useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";

/**
 * Small landing section that mirrors the mobile app's intro reel: the same
 * branded clips with captions, muted autoplay, tap to play with sound.
 */

type Clip = {
  url: string;
  caption: string;
};

const CLIPS: readonly Clip[] = [
  {
    url: "https://r2-pub.rork.com/generated-video/vaj7ce20dtfjwaoecptg3/9eb04496-dc11-4432-b884-df1d5d158e79.mp4",
    caption: "Trucks · Warehousing · Freight",
  },
  {
    url: "https://r2-pub.rork.com/generated-video/vaj7ce20dtfjwaoecptg3/2d74c88c-087f-4e2d-acf7-e7a80cc002f6.mp4",
    caption: "One network — port, road & air",
  },
  {
    url: "https://r2-pub.rork.com/generated-video/vaj7ce20dtfjwaoecptg3/3a4b9897-09a4-40f6-8838-0cb938e307d2.mp4",
    caption: "Ship & Return — parcels to your door",
  },
];

function ReelCard({ clip, delay }: { clip: Clip; delay: number }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState<boolean>(true);

  const toggle = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.muted = false;
      void el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  return (
    <Reveal delay={delay} className="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-black/40">
      <button
        type="button"
        onClick={toggle}
        className="group relative block aspect-[9/16] w-full"
        aria-label={playing ? "Pause clip" : "Play clip with sound"}
      >
        <video
          ref={videoRef}
          src={clip.url}
          className="h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <span className="pointer-events-none absolute bottom-4 left-4 right-4 text-left font-display text-lg font-bold leading-tight tracking-tight text-white drop-shadow-lg">
          {clip.caption}
        </span>
        <span className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white backdrop-blur-md transition group-hover:bg-black/70">
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </span>
      </button>
    </Reveal>
  );
}

/** Landing preview of the in-app intro reel. */
export function IntroReel() {
  return (
    <section className="relative overflow-hidden py-12">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="mb-8 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#2de2c7]">
            Inside the app
          </span>
          <h2 className="font-display mt-4 text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
            One network, end to end
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-white/60">
            The same intro our members see on launch — trucks, warehousing, freight and
            last-mile delivery. Tap any clip to play with sound.
          </p>
        </Reveal>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {CLIPS.map((clip, i) => (
            <ReelCard key={clip.url} clip={clip} delay={i * 120} />
          ))}
        </div>
      </div>
    </section>
  );
}
