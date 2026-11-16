// Attendance: one month at a time -- a summary and a row for each day that has a record, a holiday or an approved leave.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getPortalAttendance } from "@/api/employeePortalApi";
import { Card, Loading, MONTHS, Mark, Note, PageHeader, Stat, fmtDate, fmtTime, fmtWeekday, keyLine } from "./employeeUi";

const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

export default function EmployeeAttendance() {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const key = monthKey(ym.y, ym.m);
  const { data, isLoading, isError, error } = useQuery({ queryKey: ["ep-attendance", key], queryFn: () => getPortalAttendance(key), staleTime: 60_000 });
  const step = (d: number) => setYm(({ y, m }) => { const t = y * 12 + (m - 1) + d; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; });
  const s = data?.Summary;

  return (
    <>
      <PageHeader title="Attendance" subtitle="Your daily attendance records"
        action={
          <div className="flex items-center gap-2">
            <button className={keyLine} onClick={() => step(-1)} aria-label="Previous month"><ChevronLeft size={14} /></button>
            <span className="font-heading font-bold w-36 text-center">{MONTHS[ym.m - 1]} {ym.y}</span>
            <button className={keyLine} onClick={() => step(1)} aria-label="Next month"><ChevronRight size={14} /></button>
          </div>
        } />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <Stat label="Present" value={s?.Present ?? "—"} />
        <Stat label="Absent" value={s?.Absent ?? "—"} />
        <Stat label="Half day" value={s?.HalfDay ?? "—"} />
        <Stat label="On leave" value={s?.OnLeave ?? "—"} />
        <Stat label="Holidays" value={s?.Holiday ?? "—"} />
      </div>

      <Card>
        {isLoading && <Loading />}
        {isError && <Note tone="error">{(error as Error).message}</Note>}
        {data && data.Days.length === 0 && <Note>No attendance records for this month.</Note>}
        {data && data.Days.length > 0 && (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-muted-foreground border-b border-foreground/30">
              <th className="px-4 py-2">Date</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">In</th><th className="px-4 py-2">Out</th><th className="px-4 py-2 text-right">Hours</th><th className="px-4 py-2">Note</th>
            </tr></thead>
            <tbody className="divide-y divide-foreground/15">
              {data.Days.map((d) => (
                <tr key={d.Date}>
                  <td className="px-4 py-2 whitespace-nowrap">{fmtDate(d.Date)} <span className="text-muted-foreground">{fmtWeekday(d.Date)}</span></td>
                  <td className="px-4 py-2">{d.Status ? <Mark text={d.Status} /> : "—"}</td>
                  <td className="px-4 py-2 tabular-nums">{d.CheckIn ? fmtTime(d.CheckIn) : d.CheckInText || "—"}</td>
                  <td className="px-4 py-2 tabular-nums">{d.CheckOut ? fmtTime(d.CheckOut) : d.CheckOutText || "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{d.Hours != null ? d.Hours.toFixed(2) : "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{d.Note || ""}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
