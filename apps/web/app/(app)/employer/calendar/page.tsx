"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useExplore } from "@/lib/explore-store";

interface ShiftRow {
  id: string;
  title: string;
  category: string;
  status: string;
  date: string;
  start_time: string;
  end_time: string;
  hourly_rate: number | null;
  workers_needed: number | null;
  location_city: string | null;
}

interface AssignmentRow {
  id: string;
  shift_id: string;
  worker_user_id: string;
  status: string;
  worker_name?: string;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const STATUS_COLOR: Record<string, string> = {
  Posted: "bg-emerald-100 text-emerald-800",
  Filled: "bg-blue-100 text-blue-800",
  InProgress: "bg-amber-100 text-amber-800",
  Completed: "bg-slate-100 text-slate-600",
  Cancelled: "bg-red-100 text-red-700",
  Draft: "bg-muted text-muted-foreground",
};

export default function EmployerCalendarPage() {
  const { isExploring } = useExplore();
  const supabase = getBrowserSupabase();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const sampleShifts = useMemo<ShiftRow[]>(() => {
    const dd = (d: number) => `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const base = today.getDate();
    const day = (o: number) => Math.min(Math.max(base + o, 1), 28);
    return [
      { id: "ex-cal-1", title: "Warehouse Loader", category: "General", status: "Posted", date: dd(day(0)), start_time: "08:00", end_time: "16:00", hourly_rate: 24, workers_needed: 3, location_city: "Delta" },
      { id: "ex-cal-2", title: "Forklift Operator", category: "Forklift", status: "Filled", date: dd(day(0)), start_time: "09:00", end_time: "17:00", hourly_rate: 31, workers_needed: 1, location_city: "Richmond" },
      { id: "ex-cal-3", title: "Order Picker", category: "General", status: "Posted", date: dd(day(2)), start_time: "07:00", end_time: "15:00", hourly_rate: 23, workers_needed: 4, location_city: "Surrey" },
      { id: "ex-cal-4", title: "Reach Truck Driver", category: "HighReach", status: "InProgress", date: dd(day(-1)), start_time: "06:00", end_time: "14:00", hourly_rate: 33, workers_needed: 2, location_city: "Langley" },
      { id: "ex-cal-5", title: "Dock Crew", category: "General", status: "Completed", date: dd(day(-3)), start_time: "22:00", end_time: "06:00", hourly_rate: 27, workers_needed: 5, location_city: "Vancouver" },
    ];
  }, [year, month, today]);

  const sampleAssignments = useMemo<AssignmentRow[]>(() => [
    { id: "ex-ca-1", shift_id: "ex-cal-2", worker_user_id: "ex-w-3", status: "Scheduled", worker_name: "Dan Kowalski" },
    { id: "ex-ca-2", shift_id: "ex-cal-4", worker_user_id: "ex-w-5", status: "InProgress", worker_name: "Tomas Alvarez" },
  ], []);

  const shiftsQ = useQuery({
    queryKey: ["employer", "calendar-shifts", year, month],
    enabled: !isExploring,
    queryFn: async () => {
      const startDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const endDate = new Date(year, month + 1, 0);
      const endStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;

      const { data, error } = await supabase
        .from("shift_posts")
        .select("id,title,category,status,date,start_time,end_time,hourly_rate,workers_needed,location_city")
        .gte("date", startDate)
        .lte("date", endStr)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ShiftRow[];
    },
  });

  const assignmentsQ = useQuery({
    queryKey: ["employer", "calendar-assignments", year, month],
    enabled: !isExploring,
    queryFn: async () => {
      const startDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const endDate = new Date(year, month + 1, 0);
      const endStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;

      const { data, error } = await supabase
        .from("shift_assignments")
        .select(`id, shift_id, worker_user_id, status, shift_posts!inner(date), profiles!inner(name)`)
        .gte("shift_posts.date", startDate)
        .lte("shift_posts.date", endStr);
      if (error) return [];
      return (data ?? []).map((a: any) => ({
        id: a.id,
        shift_id: a.shift_id,
        worker_user_id: a.worker_user_id,
        status: a.status,
        worker_name: a.profiles?.name ?? "Unknown",
      })) as AssignmentRow[];
    },
  });

  // Group shifts by date
  const shiftsData: ShiftRow[] = isExploring ? sampleShifts : (shiftsQ.data ?? []);
  const assignmentsData: AssignmentRow[] = isExploring ? sampleAssignments : (assignmentsQ.data ?? []);

  const shiftsByDate = useMemo(() => {
    const map: Record<string, ShiftRow[]> = {};
    for (const s of shiftsData) {
      if (!map[s.date]) map[s.date] = [];
      map[s.date].push(s);
    }
    return map;
  }, [shiftsData]);

  const assignmentsByShift = useMemo(() => {
    const map: Record<string, AssignmentRow[]> = {};
    for (const a of assignmentsData) {
      if (!map[a.shift_id]) map[a.shift_id] = [];
      map[a.shift_id].push(a);
    }
    return map;
  }, [assignmentsData]);

  // Build calendar grid
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full rows of 7
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelectedDate(null);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelectedDate(null);
  };

  const selectedShifts = selectedDate ? (shiftsByDate[selectedDate] ?? []) : [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Labour calendar</h1>
          <p className="text-sm text-muted-foreground">View and manage your shifts by date.</p>
        </div>
        <Link href="/employer/create-shift">
          <Button>+ Post shift</Button>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Calendar */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{MONTHS[month]} {year}</CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={prevMonth}>‹</Button>
                  <Button size="sm" variant="outline" onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); setSelectedDate(null); }}>
                    Today
                  </Button>
                  <Button size="sm" variant="outline" onClick={nextMonth}>›</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!isExploring && shiftsQ.isLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
              ) : (
                <div>
                  <div className="grid grid-cols-7 mb-2">
                    {DAYS.map(d => (
                      <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {cells.map((day, i) => {
                      if (!day) return <div key={i} />;
                      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                      const dayShifts = shiftsByDate[dateStr] ?? [];
                      const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
                      const isSelected = selectedDate === dateStr;
                      return (
                        <button
                          key={i}
                          onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                          className={`min-h-[72px] rounded-md border p-1.5 text-left transition-colors hover:border-primary ${
                            isSelected ? "border-primary bg-accent" : isToday ? "border-primary/50 bg-primary/5" : "border-border"
                          }`}
                        >
                          <div className={`text-xs font-medium mb-1 ${isToday ? "text-primary" : ""}`}>{day}</div>
                          <div className="space-y-0.5">
                            {dayShifts.slice(0, 3).map(s => (
                              <div key={s.id} className={`rounded px-1 py-0.5 text-[10px] truncate ${STATUS_COLOR[s.status] ?? "bg-muted text-muted-foreground"}`}>
                                {s.start_time?.slice(0,5)} {s.title}
                              </div>
                            ))}
                            {dayShifts.length > 3 && (
                              <div className="text-[10px] text-muted-foreground pl-1">+{dayShifts.length - 3} more</div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Day detail panel */}
        <div>
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="text-base">
                {selectedDate
                  ? new Date(selectedDate + "T12:00:00").toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })
                  : "Select a date"}
              </CardTitle>
              <CardDescription>
                {selectedDate && selectedShifts.length > 0
                  ? `${selectedShifts.length} shift${selectedShifts.length !== 1 ? "s" : ""}`
                  : selectedDate ? "No shifts" : "Click a day to see shifts"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedShifts.map((s) => {
                const assignments = assignmentsByShift[s.id] ?? [];
                const active = assignments.filter(a => ["Scheduled","InProgress"].includes(a.status));
                return (
                  <div key={s.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-sm">{s.title}</div>
                        <div className="text-xs text-muted-foreground">{s.start_time?.slice(0,5)} – {s.end_time?.slice(0,5)} · {s.category}</div>
                      </div>
                      <Badge variant={s.status === "Posted" ? "success" : s.status === "Filled" ? "default" : "secondary"} className="shrink-0 text-xs">
                        {s.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {active.length} / {s.workers_needed ?? "?"} assigned
                      {s.hourly_rate ? ` · $${Number(s.hourly_rate).toFixed(2)}/hr` : ""}
                    </div>
                    {active.length > 0 && (
                      <div className="space-y-1">
                        {active.map(a => (
                          <div key={a.id} className="text-xs bg-muted rounded px-2 py-1">{a.worker_name}</div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {selectedDate && selectedShifts.length === 0 && (
                <Link href="/employer/create-shift">
                  <Button variant="outline" className="w-full">+ Post shift for this day</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
