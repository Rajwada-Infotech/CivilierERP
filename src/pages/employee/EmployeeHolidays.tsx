// Holiday list: the company's official holidays for a year.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getPortalHolidays } from "@/api/employeePortalApi";
import { Card, Loading, Note, PageHeader, fmtDate, fmtWeekday, keyLine } from "./employeeUi";

export default function EmployeeHolidays() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, isLoading, isError, error } = useQuery({ queryKey: ["ep-holidays", year], queryFn: () => getPortalHolidays(year), staleTime: 5 * 60_000 });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Holiday List" subtitle="Official company holidays"
        action={
          <div className="flex items-center gap-2">
            <button className={keyLine} onClick={() => setYear((y) => y - 1)} aria-label="Previous year"><ChevronLeft size={14} /></button>
            <span className="font-heading font-bold w-16 text-center">{year}</span>
            <button className={keyLine} onClick={() => setYear((y) => y + 1)} aria-label="Next year"><ChevronRight size={14} /></button>
          </div>
        } />
      <Card>
        {isLoading && <Loading />}
        {isError && <Note tone="error">{(error as Error).message}</Note>}
        {data && data.length === 0 && <Note>No holidays listed for {year}.</Note>}
        {data && data.length > 0 && (
          <ul className="divide-y divide-foreground/15">
            {data.map((h) => {
              const past = h.HolidayDate.slice(0, 10) < today;
              return (
                <li key={h.HolidayId} className={`flex items-center justify-between gap-3 px-4 py-3 text-sm ${past ? "text-muted-foreground" : ""}`}>
                  <span className="font-medium">{h.HolidayName}</span>
                  <span className="tabular-nums">{fmtDate(h.HolidayDate)} <span className="text-muted-foreground">{fmtWeekday(h.HolidayDate)}</span></span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
