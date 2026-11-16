// Inside the Attendance Record "View" dialog: the live photo and the device location captured when the day was punched
// (Employee Portal / staff Attendance), for In and Out. A day entered by hand has none.
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { getAttendancePunch, type PunchLocation } from "@/api/attendanceRecordApi";

const mapUrl = (l: PunchLocation) => `https://www.google.com/maps?q=${l.lat},${l.lng}`;
const ist = (d: string | null) =>
  d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";

export const AttendancePunchEvidence: React.FC<{ attendanceId: number }> = ({ attendanceId }) => {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["attendance-punch", attendanceId],
    queryFn: () => getAttendancePunch(attendanceId),
    staleTime: 60_000,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (isError) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">No punch photo or location — this day was entered by hand.</p>;

  const sides = [
    { label: "In", time: data.inTime, photo: data.inPhoto, loc: data.inLocation },
    { label: "Out", time: data.outTime, photo: data.outPhoto, loc: data.outLocation },
  ];
  const dur = (sec: number | null) => { const m = Math.round((sec ?? 0) / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`; };
  return (
    <div className="space-y-4">
    {(data.breaks.length > 0) && (
      <div className="text-sm space-y-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Breaks</p>
        <ul className="divide-y divide-foreground/15 border border-foreground/20">
          {data.breaks.map((b, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span><b>{b.type}</b>{b.note ? <span className="text-muted-foreground"> — {b.note}</span> : null}<span className="text-muted-foreground tabular-nums"> · {ist(b.start)}–{ist(b.end)}</span></span>
              <span className="tabular-nums">{dur(b.seconds)}{!b.deduct ? " (work)" : ""}{b.overSeconds > 0 && <b className="text-red-600 dark:text-red-400"> · {dur(b.overSeconds)} extra</b>}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">Break time {dur(data.breakSeconds)} · Official work out {dur(data.officialSeconds)} · Extra {dur(data.extraSeconds)} · Net working {data.netSeconds != null ? dur(data.netSeconds) : "—"}</p>
      </div>
    )}
    <div className="grid sm:grid-cols-2 gap-4">
      {sides.map((s) => (
        <div key={s.label} className="space-y-2">
          <p className="text-sm font-medium">{s.label} <span className="text-muted-foreground tabular-nums">· {ist(s.time)}</span></p>
          {s.photo
            ? <img src={s.photo} alt={`${s.label} photo`} className="w-full max-w-[16rem] border border-foreground/30" />
            : <div className="w-full max-w-[16rem] aspect-[4/3] bg-muted/40 flex items-center justify-center text-xs text-muted-foreground">{s.time ? "No photo" : "Not punched out"}</div>}
          {s.loc ? (
            <a href={mapUrl(s.loc)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline underline-offset-2">
              <MapPin size={12} /> {s.loc.lat.toFixed(6)}, {s.loc.lng.toFixed(6)}{s.loc.accuracyM != null ? ` (±${s.loc.accuracyM} m)` : ""} — open map
            </a>
          ) : <p className="text-xs text-muted-foreground">No location</p>}
        </div>
      ))}
    </div>
    </div>
  );
};
