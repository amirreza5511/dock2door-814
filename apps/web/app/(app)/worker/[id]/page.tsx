"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Award, Camera, CheckCircle2, MapPin, Star, Zap } from "lucide-react";
import { skillLabel } from "@/lib/skills";

interface WorkerPublic {
  id: string;
  user_id: string;
  display_name: string;
  bio: string | null;
  tagline: string | null;
  skills: string[] | null;
  coverage_cities: string[] | null;
  hourly_expectation: number | null;
  verified: boolean;
  status: string;
  profile_photo_path: string | null;
  avatar_path: string | null;
  languages: string[] | null;
  experience_years: number | null;
  transportation: string | null;
  work_history: string | null;
  education: string | null;
  references_text: string | null;
}

interface CertRow { id: string; type: string; expiry_date: string | null; status: string }
interface PhotoRow { id: string; file_path: string; caption: string | null }
interface ReviewRow { id: string; rating: number; comment: string | null; created_at: string; reviewer_company: { name: string } | { name: string }[] | null }
interface AssignmentCountRow { id: string; status: string }
interface AvailabilityRow { date: string; kind: string }

const WEEK_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function getWeekDays(): { label: string; isoDate: string }[] {
  const result: { label: string; isoDate: string }[] = [];
  const today = new Date();
  const dayOfWeek = (today.getDay() + 6) % 7;
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - dayOfWeek + i);
    result.push({ label: WEEK_LABELS[i], isoDate: d.toISOString().split("T")[0] });
  }
  return result;
}

export default function WorkerPublicProfilePage() {
  const supabase = getBrowserSupabase();
  const router = useRouter();
  const routeParams = useParams<{ id: string }>();
  const userId = String(routeParams?.id ?? "");

  const profileQ = useQuery({
    queryKey: ["worker-by-id", userId],
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
      const [profileRes, certsRes, photosRes, reviewsRes, assignmentsRes, availRes] = await Promise.all([
        supabase
          .from("worker_profiles")
          .select("id,user_id,display_name,bio,tagline,skills,coverage_cities,hourly_expectation,verified,status,profile_photo_path,avatar_path,languages,experience_years,transportation,work_history,education,references_text")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("worker_certifications")
          .select("id,type,expiry_date,status")
          .eq("worker_user_id", userId)
          .eq("status", "Approved"),
        supabase
          .from("work_photos")
          .select("id,file_path,caption,visibility,moderation_status")
          .eq("worker_user_id", userId)
          .in("visibility", ["public", "company"])
          .eq("moderation_status", "approved")
          .order("created_at", { ascending: false })
          .limit(24),
        supabase
          .from("reviews")
          .select("id,rating,comment,created_at,reviewer_company:reviewer_company_id(name)")
          .eq("target_user_id", userId)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("shift_assignments")
          .select("id,status")
          .eq("worker_user_id", userId),
        supabase
          .from("worker_availability")
          .select("date,kind")
          .eq("worker_user_id", userId)
          .gte("date", today)
          .lte("date", nextWeek),
      ]);
      return {
        profile: (profileRes.data ?? null) as WorkerPublic | null,
        certs: (certsRes.data ?? []) as CertRow[],
        photos: (photosRes.data ?? []) as PhotoRow[],
        reviews: (reviewsRes.data ?? []) as unknown as ReviewRow[],
        assignments: (assignmentsRes.data ?? []) as AssignmentCountRow[],
        availability: (availRes.data ?? []) as AvailabilityRow[],
      };
    },
  });

  const { profile, certs, photos, reviews, assignments, availability } = profileQ.data ?? {
    profile: null, certs: [], photos: [], reviews: [], assignments: [], availability: [],
  };

  const photoUrlsQ = useQuery({
    queryKey: ["worker-id-photos", userId, photos.map((p) => p.id).join(",")],
    enabled: photos.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const entries = await Promise.all(
        photos.map(async (p) => {
          try {
            const { data } = await supabase.functions.invoke("get-signed-url", {
              body: { bucket: "worker-photos", path: p.file_path },
            });
            const url = (data as { signedUrl?: string; url?: string } | null)?.signedUrl
              ?? (data as { url?: string } | null)?.url ?? "";
            return [p.id, url] as [string, string];
          } catch {
            return [p.id, ""] as [string, string];
          }
        }),
      );
      return Object.fromEntries(entries.filter(([, v]) => v));
    },
  });
  const photoUrls = photoUrlsQ.data ?? {};

  const avgRating = useMemo(() => {
    if (reviews.length === 0) return 0;
    return reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  }, [reviews]);

  const reliability = useMemo(() => {
    const completed = assignments.filter((a) => ["Completed", "HoursConfirmed", "Confirmed"].includes(a.status)).length;
    const noShows = assignments.filter((a) => a.status === "NoShow").length;
    const total = completed + noShows;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total: completed, noShows, pct };
  }, [assignments]);

  const weekDays = getWeekDays();
  // Available EVERY day by default; a day is only "off" when there is an
  // explicit `unavailable` row for that date.
  const offDates = useMemo(() => {
    const s = new Set<string>();
    for (const a of availability) if (a.kind === "unavailable") s.add(a.date);
    return s;
  }, [availability]);

  if (profileQ.isLoading) {
    return <div className="mx-auto max-w-3xl py-16 text-center text-sm text-muted-foreground">Loading profile…</div>;
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-sm text-muted-foreground">Worker profile not found.</p>
        <Button className="mt-4" variant="outline" onClick={() => router.back()}>Go back</Button>
      </div>
    );
  }

  const initial = profile.display_name?.charAt(0)?.toUpperCase() ?? "?";
  const todayIso = new Date().toISOString().split("T")[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button variant="ghost" className="gap-2" onClick={() => router.back()}>
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>

      {/* Hero */}
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-full border-2 border-primary bg-primary/15 text-2xl font-bold text-primary">
            {initial}
          </div>
          <h1 className="text-xl font-semibold">{profile.display_name}</h1>
          {profile.tagline ? <p className="text-sm font-medium text-primary">{profile.tagline}</p> : null}
          <div className="flex items-center gap-2">
            {profile.verified && (
              <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Verified</Badge>
            )}
            <Badge variant={profile.status === "Active" ? "success" : "warning"}>{profile.status}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Decision stats */}
      <Card>
        <CardContent className="py-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Employer decision stats</p>
          <div className="grid grid-cols-3 divide-x divide-border text-center">
            <div className="px-2">
              <p className={`text-2xl font-bold ${reliability.pct > 80 ? "text-emerald-500" : reliability.pct > 50 ? "text-amber-500" : "text-red-500"}`}>
                {reliability.total > 0 ? `${reliability.pct}%` : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Completion</p>
              {reliability.total > 0 && <p className="text-[11px] text-muted-foreground">{reliability.total} shifts</p>}
            </div>
            <div className="px-2">
              <p className={`text-2xl font-bold ${avgRating > 0 ? "text-amber-500" : "text-muted-foreground"}`}>
                {avgRating > 0 ? avgRating.toFixed(1) : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Rating</p>
              {reviews.length > 0 && (
                <div className="mt-1 flex justify-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className={`h-2.5 w-2.5 ${n <= Math.round(avgRating) ? "fill-amber-400 text-amber-400" : "text-border"}`} />
                  ))}
                </div>
              )}
            </div>
            <div className="px-2">
              <Zap className="mx-auto h-4 w-4 text-blue-500" />
              <p className="text-xs text-muted-foreground">Response</p>
              <p className="text-[11px] text-muted-foreground">&lt;2h typically</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Availability */}
      <Card>
        <CardContent className="py-5">
          <p className="mb-3 text-sm font-semibold">Availability this week</p>
          <div className="flex justify-between">
            {weekDays.map(({ label, isoDate }) => {
              const isAvail = !offDates.has(isoDate);
              const isToday = isoDate === todayIso;
              return (
                <div key={isoDate} className={`flex flex-1 flex-col items-center gap-2 rounded-md py-1 ${isToday ? "bg-primary/10" : ""}`}>
                  <span className={`text-xs font-medium ${isToday ? "text-primary" : "text-muted-foreground"}`}>{label}</span>
                  <span className={`h-2.5 w-2.5 rounded-full ${isAvail ? "bg-emerald-500" : "bg-border"}`} />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Certifications */}
      {certs.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Certifications</h2>
          <div className="flex flex-wrap gap-2">
            {certs.map((c) => (
              <span key={c.id} className="flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-600">
                <Award className="h-3 w-3" /> {c.type}
                {c.expiry_date ? <span className="font-normal text-muted-foreground">exp. {c.expiry_date}</span> : null}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Skills */}
      {(profile.skills ?? []).length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Skills</h2>
          <div className="flex flex-wrap gap-2">
            {(profile.skills ?? []).map((s) => (
              <span key={s} className="rounded-md bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">{skillLabel(s)}</span>
            ))}
          </div>
        </div>
      )}

      {/* Coverage cities */}
      {(profile.coverage_cities ?? []).length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Coverage cities</h2>
          <div className="flex flex-wrap gap-2">
            {(profile.coverage_cities ?? []).map((c) => (
              <span key={c} className="flex items-center gap-1 rounded-md bg-blue-500/10 px-2.5 py-1.5 text-xs font-semibold text-blue-600">
                <MapPin className="h-3 w-3" /> {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Bio */}
      {profile.bio ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold">About</h2>
          <Card><CardContent className="py-4 text-sm leading-relaxed text-muted-foreground">{profile.bio}</CardContent></Card>
        </div>
      ) : null}

      {/* Experience & languages */}
      {(Number(profile.experience_years) > 0 || (profile.languages ?? []).length > 0 || profile.transportation) ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Experience</h2>
          <Card><CardContent className="space-y-1.5 py-4 text-sm text-muted-foreground">
            {Number(profile.experience_years) > 0 ? (
              <p><span className="font-medium text-foreground">Years of experience: </span>{profile.experience_years}</p>
            ) : null}
            {(profile.languages ?? []).length > 0 ? (
              <p><span className="font-medium text-foreground">Languages: </span>{(profile.languages ?? []).join(", ")}</p>
            ) : null}
            {profile.transportation ? (
              <p><span className="font-medium text-foreground">Transportation: </span>{profile.transportation}</p>
            ) : null}
          </CardContent></Card>
        </div>
      ) : null}

      {/* Work history */}
      {profile.work_history ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Work history</h2>
          <Card><CardContent className="whitespace-pre-line py-4 text-sm leading-relaxed text-muted-foreground">{profile.work_history}</CardContent></Card>
        </div>
      ) : null}

      {/* Education */}
      {profile.education ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Education & training</h2>
          <Card><CardContent className="whitespace-pre-line py-4 text-sm leading-relaxed text-muted-foreground">{profile.education}</CardContent></Card>
        </div>
      ) : null}

      {/* References */}
      {profile.references_text ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold">References</h2>
          <Card><CardContent className="whitespace-pre-line py-4 text-sm leading-relaxed text-muted-foreground">{profile.references_text}</CardContent></Card>
        </div>
      ) : null}

      {/* Gallery */}
      {photos.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Work gallery</h2>
          <div className="grid grid-cols-3 gap-1.5">
            {photos.map((p) => (
              <div key={p.id} className="aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                {photoUrls[p.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrls[p.id]} alt={p.caption ?? "Work photo"} className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center"><Camera className="h-5 w-5 text-muted-foreground" /></div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reviews */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Reviews</h2>
          {reviews.length > 0 && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} className={`h-3.5 w-3.5 ${n <= Math.round(avgRating) ? "fill-amber-400 text-amber-400" : "text-border"}`} />
              ))}
              <span className="ml-1 font-medium">{avgRating.toFixed(1)} ({reviews.length})</span>
            </div>
          )}
        </div>
        {reviews.length === 0 ? (
          <Card><CardContent className="py-4 text-center text-sm italic text-muted-foreground">No reviews yet.</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {reviews.map((r) => {
              const company = Array.isArray(r.reviewer_company) ? r.reviewer_company[0] : r.reviewer_company;
              return (
                <Card key={r.id}>
                  <CardContent className="py-4">
                    <div className="mb-1.5 flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={`h-3.5 w-3.5 ${n <= r.rating ? "fill-amber-400 text-amber-400" : "text-border"}`} />
                      ))}
                      <span className="ml-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                    {r.comment ? <p className="text-sm text-muted-foreground">{r.comment}</p> : null}
                    {company?.name ? <p className="mt-1 text-xs italic text-muted-foreground">by {company.name}</p> : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
