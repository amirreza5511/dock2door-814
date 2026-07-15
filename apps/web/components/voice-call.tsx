"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Loader2, Mic } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";

/**
 * In-app 1:1 voice call over WebRTC. Signaling runs on a Supabase Realtime
 * broadcast channel (no phone numbers exchanged); ICE servers come from the
 * Rork toolkit endpoint. Audio-only, browser-only. Both peers open the same
 * `room`; the driver is the impolite peer (creates the offer), the receiver
 * is polite (answers) — the perfect-negotiation pattern.
 */
type CallState = "idle" | "connecting" | "in-call" | "ended" | "error";

const TOOLKIT_URL = process.env.NEXT_PUBLIC_TOOLKIT_URL || process.env.EXPO_PUBLIC_TOOLKIT_URL || "";
const TOOLKIT_KEY = process.env.NEXT_PUBLIC_RORK_TOOLKIT_SECRET_KEY || process.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY || "";

async function fetchIceServers(signal?: AbortSignal): Promise<RTCIceServer[]> {
  const fallback: RTCIceServer[] = [{ urls: ["stun:stun.cloudflare.com:3478"] }];
  if (!TOOLKIT_URL || !TOOLKIT_KEY) return fallback;
  try {
    const res = await fetch(`${TOOLKIT_URL.replace(/\/+$/, "")}/v2/webrtc/ice-servers`, {
      headers: { Authorization: `Bearer ${TOOLKIT_KEY}` },
      signal,
    });
    if (!res.ok) return fallback;
    const json = (await res.json()) as { iceServers?: RTCIceServer[] };
    return json.iceServers && json.iceServers.length > 0 ? json.iceServers : fallback;
  } catch {
    return fallback;
  }
}

export function VoiceCallButton({ room, role, className }: { room: string; role: "driver" | "receiver"; className?: string }) {
  const [state, setState] = useState<CallState>("idle");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<ReturnType<ReturnType<typeof getBrowserSupabase>["channel"]> | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const makingOffer = useRef(false);
  const negotiated = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const supported = typeof window !== "undefined" && typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof RTCPeerConnection !== "undefined";
  const polite = role === "receiver";

  const cleanup = useCallback(() => {
    abortRef.current?.abort();
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null;
    if (channelRef.current) { try { getBrowserSupabase().removeChannel(channelRef.current); } catch {} channelRef.current = null; }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    pendingCandidates.current = [];
    makingOffer.current = false;
    negotiated.current = false;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const send = useCallback((payload: Record<string, unknown>) => {
    channelRef.current?.send({ type: "broadcast", event: "signal", payload });
  }, []);

  const start = useCallback(async () => {
    if (!supported) { setError("Voice calls need a modern browser."); setState("error"); return; }
    setError(null);
    setState("connecting");
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;

      const iceServers = await fetchIceServers(abort.signal);
      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.ontrack = (e) => {
        if (audioElRef.current) {
          audioElRef.current.srcObject = e.streams[0];
          void audioElRef.current.play().catch(() => {});
        }
      };
      pc.onicecandidate = (e) => { if (e.candidate) send({ kind: "candidate", candidate: e.candidate.toJSON() }); };
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === "connected") setState("in-call");
        else if (s === "failed" || s === "closed" || s === "disconnected") setState((prev) => (prev === "in-call" ? "ended" : prev));
      };

      const supabase = getBrowserSupabase();
      const channel = supabase.channel(`voice-${room}`, { config: { broadcast: { self: false } } });
      channelRef.current = channel;

      const makeOffer = async () => {
        if (negotiated.current || polite) return; // impolite peer drives the offer
        negotiated.current = true;
        try {
          makingOffer.current = true;
          await pc.setLocalDescription(await pc.createOffer());
          send({ kind: "description", description: pc.localDescription?.toJSON() });
        } finally {
          makingOffer.current = false;
        }
      };

      channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
        const msg = payload as { kind: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
        try {
          if (msg.kind === "ready") {
            void makeOffer();
          } else if (msg.kind === "description" && msg.description) {
            const desc = msg.description;
            const offerCollision = desc.type === "offer" && (makingOffer.current || pc.signalingState !== "stable");
            if (!polite && offerCollision) return; // impolite ignores colliding offers
            await pc.setRemoteDescription(desc);
            for (const c of pendingCandidates.current.splice(0)) { try { await pc.addIceCandidate(c); } catch {} }
            if (desc.type === "offer") {
              await pc.setLocalDescription(await pc.createAnswer());
              send({ kind: "description", description: pc.localDescription?.toJSON() });
            }
          } else if (msg.kind === "candidate" && msg.candidate) {
            if (pc.remoteDescription) { try { await pc.addIceCandidate(msg.candidate); } catch {} }
            else pendingCandidates.current.push(msg.candidate);
          }
        } catch (err) {
          console.error("[voice] signal error", err);
        }
      });

      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") send({ kind: "ready" });
      });
    } catch (err) {
      cleanup();
      const msg = err instanceof Error ? err.message : "Unable to start the call";
      setError(msg.includes("Permission") || msg.includes("denied") ? "Microphone access was blocked." : msg);
      setState("error");
    }
  }, [supported, room, polite, send, cleanup]);

  const hangUp = useCallback(() => { cleanup(); setState("ended"); }, [cleanup]);

  const toggleMute = useCallback(() => {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    const next = !muted;
    tracks.forEach((t) => { t.enabled = !next; });
    setMuted(next);
  }, [muted]);

  const talkLabel = role === "driver" ? "Talk to receiver" : "Talk to driver";

  if (!supported) return null;

  if (state === "in-call" || state === "connecting") {
    return (
      <div className={`flex items-center gap-2 rounded-xl border border-white/10 bg-card px-3 py-2 ${className ?? ""}`}>
        <audio ref={audioElRef} autoPlay className="hidden" />
        <span className="flex flex-1 items-center gap-2 text-sm font-medium">
          {state === "connecting" ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />}
          {state === "connecting" ? "Connecting…" : "In call"}
        </span>
        <button onClick={toggleMute} className={`grid h-9 w-9 place-items-center rounded-lg border ${muted ? "border-amber-500/50 bg-amber-500/10 text-amber-400" : "border-white/10 text-muted-foreground"}`} aria-label="Mute">
          <Mic className="h-4 w-4" />
        </button>
        <button onClick={hangUp} className="grid h-9 w-9 place-items-center rounded-lg bg-red-500 text-white" aria-label="Hang up">
          <PhoneOff className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className={className}>
      <audio ref={audioElRef} autoPlay className="hidden" />
      <button
        onClick={() => void start()}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
      >
        <Phone className="h-4 w-4" /> {talkLabel}
      </button>
      {(state === "error" || state === "ended") && (
        <p className="mt-1 text-xs text-muted-foreground">{state === "ended" ? "Call ended." : error}</p>
      )}
    </div>
  );
}
