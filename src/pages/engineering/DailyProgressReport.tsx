// Daily Progress Report: the BOQs, work orders and work done created on one day (GET /api/engineering/dpr?date=).
// Parts under ./dpr: config (types, formatters, styles) · DprTables (the three sections) · dprExport (CSV, print).
import React, { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, Printer, RefreshCw } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, Skel } from "@/components/sheet/Sheet";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DateInput } from "@/components/ui/date-input";
import { type DPRResponse, KEY_INK, KEY_LINE, RULE, fmt, fmtDate, todayStr } from "./dpr/config";
import { BOQTable, Section, WorkDoneTable, WorkOrderTable } from "./dpr/DprTables";
import { PrintView, downloadCSV, printPDF } from "./dpr/dprExport";

export default function DailyProgressReport() {
  const rights = usePageRights("dpr");
  const [date, setDate] = useState(todayStr());
  const printRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<DPRResponse>({
    queryKey: ["engineering-dpr", date],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/engineering/dpr?date=${date}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      return body;
    },
    enabled: !!date,
    staleTime: 2 * 60 * 1000,
  });

  const handleCSV = useCallback(() => {
    if (data) downloadCSV(data);
  }, [data]);
  const handlePDF = useCallback(() => {
    if (data) printPDF(printRef, date);
  }, [data, date]);

  const s = data?.summary;
  const docs = s ? s.boqCount + s.woCount + s.wdCount : 0;
  const figures = [
    { label: "BOQs", value: fmt(s?.boqTotal), note: `${s?.boqCount ?? 0} created` },
    { label: "Work orders", value: fmt(s?.woTotal), note: `${s?.woCount ?? 0} created` },
    { label: "Work certified", value: fmt(s?.wdTotal), note: `${s?.wdCount ?? 0} entr${s?.wdCount === 1 ? "y" : "ies"}` },
    { label: "Documents", value: String(docs), note: data ? `created on ${fmtDate(data.date)}` : "" },
  ];

  return (
    <>
      <Breadcrumbs items={["Engineering", "Daily Progress Report"]} />
      <SheetShell
        eyebrow="CivilierERP · Engineering"
        title="Daily progress report"
        subtitle="The BOQs, work orders and work done created on one day. Values leave rejected documents out."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <DateInput
              value={date}
              max={todayStr()}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 w-40 border border-foreground/40 focus:border-foreground bg-card px-3 text-sm text-foreground outline-none"
            />
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh">
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            </button>
            {rights.canExport && (
              <button onClick={handleCSV} disabled={!data} className={`${KEY_LINE} h-9 px-3`}>
                <FileSpreadsheet size={13} /> CSV
              </button>
            )}
            {rights.canPrint && (
              <button onClick={handlePDF} disabled={!data} className={`${KEY_INK} h-9 px-4`}>
                <Printer size={13} /> Print / PDF
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <p className="label">{x.label}</p>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{isLoading ? "" : x.note}</p>
                </div>
              ))}
            </div>
          </div>

          {isError && (
            <div className="bg-card px-4 py-3" style={{ border: "1px solid hsl(var(--destructive))" }}>
              <p className="text-sm font-semibold text-destructive">Could not load the report</p>
              <p className="text-xs text-muted-foreground mt-0.5">{(error as Error)?.message ?? "Unknown error"}</p>
            </div>
          )}

          {isLoading && (
            <div className="bg-card p-5" style={{ border: RULE }}>
              <Skel h={16} w="40%" />
              <Skel />
              <Skel />
              <Skel w="70%" />
            </div>
          )}

          {data && (
            <>
              <Section title="BOQs" count={s!.boqCount} total={s!.boqTotal} totalLabel="Value">
                <BOQTable rows={data.boq} />
              </Section>
              <Section title="Work orders" count={s!.woCount} total={s!.woTotal} totalLabel="Value">
                <WorkOrderTable rows={data.workOrders} />
              </Section>
              <Section title="Work done" count={s!.wdCount} total={s!.wdTotal} totalLabel="Certified">
                <WorkDoneTable rows={data.workDone} />
              </Section>
            </>
          )}
        </div>
      </SheetShell>

      {/* What Print / PDF copies into its window */}
      <div style={{ display: "none" }}>
        <div ref={printRef}>{data && <PrintView data={data} />}</div>
      </div>
    </>
  );
}
