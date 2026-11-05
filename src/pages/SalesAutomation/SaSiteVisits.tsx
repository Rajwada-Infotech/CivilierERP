import React, { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { MasterPage, type DataChangeEvent, type RecordWithId, type FieldDef } from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { CalendarClock, LayoutList, AlertTriangle, CheckCircle2, XCircle, PhoneCall } from "lucide-react";
import { SaTabs } from "@/components/sa/SaTabs";
import { StatusCell, TitleCell } from "@/components/sa/saCells";

const API = "/api/sa/site-visits";

async function fetchVisits(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch site visits");
  return res.json().catch(() => ({}));
}
async function fetchLeadOptions(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth("/api/sa/leads");
    if (!res.ok) return [];
    const data: any[] = await res.json();
    return data.map((l) => ({ value: String(l.Id), label: `${l.LeadUid} - ${l.CustomerName} (${l.Mobile})` }));
  } catch { return []; }
}
async function fetchUserOptions(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth("/api/sa/leads/users");
    if (!res.ok) return [];
    const data: any[] = await res.json();
    return data.map((u) => ({ value: String(u.Id), label: `${u.Name} (${u.role})` }));
  } catch { return []; }
}

const fields: FieldDef[] = [
  { name: "LeadId", label: "Lead", type: "select", required: true, asyncOptions: fetchLeadOptions },
  { name: "ProjectName", label: "Project Name", type: "text" },
  { name: "PreferredDate", label: "Preferred Date", type: "date" },
  { name: "PreferredTime", label: "Preferred Time", type: "text", placeholder: "e.g. 11:00" },
  { name: "ExecutiveId", label: "Executive", type: "select", asyncOptions: fetchUserOptions },
  { name: "PickupRequired", label: "Pickup Needed", type: "select", options: ["Yes", "No"], defaultValue: "No" },
  { name: "CustomerNotes", label: "Customer Notes", type: "textarea", fullWidth: true, placeholder: "Pickup address, who is coming, what they want to see…" },
  { name: "Status", label: "Status", type: "select", options: ["Scheduled","Confirmed","Completed","Cancelled","Rescheduled"], defaultValue: "Scheduled" },
];

const columns = [
  { key: "CustomerName", label: "Customer" },
  { key: "PreferredDate", label: "Visit" },
  { key: "ProjectName", label: "Project", hideOnMobile: true },
  { key: "ExecutiveName", label: "Executive", hideOnMobile: true },
  { key: "Status", label: "Status" },
];

// Visits in these statuses are finished with.
const CLOSED = ["Completed", "Cancelled"];
const STATUS_DONE: Record<string, string> = { Confirmed: "confirmed", Completed: "marked as visited", Cancelled: "cancelled" };
const DAY = 24 * 60 * 60 * 1000;
const daysFrom = (today: Date, v: RecordWithId) => Math.round((new Date(String(v.PreferredDate)).setHours(0, 0, 0, 0) - today.getTime()) / DAY);
const fmtDay = (d: unknown) =>
  d ? new Date(String(d)).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" }) : "—";

const exportColumns: ExportColumn[] = [
  { header: "Lead ID", accessor: "LeadUid" },
  { header: "Customer", accessor: "CustomerName" },
  { header: "Mobile", accessor: "Mobile" },
  { header: "Project", accessor: "ProjectName" },
  { header: "Preferred Date", accessor: "PreferredDate" },
  { header: "Preferred Time", accessor: "PreferredTime" },
  { header: "Executive", accessor: "ExecutiveName" },
  { header: "Pickup Required", accessor: "PickupRequired" },
  { header: "Customer Notes", accessor: "CustomerNotes" },
  { header: "Status", accessor: "Status" },
];

const SaSiteVisits: React.FC = () => {
  usePageRights("sa-site-visits");
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"list" | "upcoming" | "overdue">("upcoming");
  const { data: visits, isLoading, isFetching, dataUpdatedAt, refetch, error } = useQuery({ queryKey: ["sa-site-visits"], queryFn: fetchVisits, staleTime: 30_000 });

  const mappedData: RecordWithId[] = useMemo(() => {
    if (!Array.isArray(visits)) return [];
    return visits.map((v) => ({
      _id: String(v.Id),
      LeadId: String(v.LeadId ?? ""),
      LeadUid: v.LeadUid ?? "",
      CustomerName: v.CustomerName ?? "",
      Mobile: v.Mobile ?? "",
      Classification: v.Classification ?? "",
      ProjectName: v.ProjectName ?? "",
      PreferredDate: v.PreferredDate ? String(v.PreferredDate).slice(0, 10) : "",
      PreferredTime: v.PreferredTime ?? "",
      ExecutiveId: String(v.ExecutiveId ?? ""),
      ExecutiveName: v.ExecutiveName ?? "",
      PickupRequired: v.PickupRequired ? "Yes" : "No",
      CustomerNotes: v.CustomerNotes ?? "",
      Status: v.Status ?? "Scheduled",
    }));
  }, [visits]);

  const toPayload = (r: Record<string, any>) => ({
    LeadId: r.LeadId ? parseInt(r.LeadId) : null,
    ProjectName: r.ProjectName || null,
    PreferredDate: r.PreferredDate || null,
    PreferredTime: r.PreferredTime || null,
    ExecutiveId: r.ExecutiveId ? parseInt(r.ExecutiveId) : null,
    PickupRequired: r.PickupRequired === "Yes",
    CustomerNotes: r.CustomerNotes || null,
    Status: r.Status || "Scheduled",
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      const res = await fetchWithAuth(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toPayload(event.record)) });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to schedule visit");
      toast.success("Site visit scheduled!");
    }
    if (event.action === "update") {
      const res = await fetchWithAuth(`${API}/${event.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toPayload(event.record)) });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update visit");
      toast.success("Site visit updated!");
    }
    if (event.action === "delete") {
      const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to cancel visit");
      toast.success("Site visit cancelled!");
    }
    await queryClient.invalidateQueries({ queryKey: ["sa-site-visits"] });
    await queryClient.invalidateQueries({ queryKey: ["sa-leads"] });
  };

  if (isLoading || error) return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Engagement", "Site Visits"]} title="Site Visits">
      <div className={`p-6 text-sm ${error ? "text-red-500" : "text-muted-foreground"}`}>
        {error ? "Couldn't load site visits. Refresh the page to try again." : "Loading site visits…"}
      </div>
    </SalesAutoShell>
  );

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const open = mappedData.filter((v) => v.PreferredDate && !CLOSED.includes(String(v.Status)));
  const byDate = (a: RecordWithId, b: RecordWithId) => String(a.PreferredDate).localeCompare(String(b.PreferredDate));
  const upcoming = open.filter((v) => new Date(String(v.PreferredDate)) >= today).sort(byDate);
  const overdueVisits = open.filter((v) => new Date(String(v.PreferredDate)) < today).sort(byDate);
  const todayCount = upcoming.filter((v) => daysFrom(today, v) === 0).length;
  const unscheduled = mappedData.filter((v) => !v.PreferredDate && !CLOSED.includes(String(v.Status))).length;
  const canEdit = canDoAction("sa-site-visits", "edit");

  // Quick status change from a card — same PUT as the edit form.
  const setStatus = async (v: RecordWithId, Status: string) => {
    try {
      const res = await fetchWithAuth(`${API}/${v._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload({ ...v, Status })),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't update the visit");
      toast.success(`${v.CustomerName}: visit ${STATUS_DONE[Status] ?? Status.toLowerCase()}`);
      await queryClient.invalidateQueries({ queryKey: ["sa-site-visits"] });
      await queryClient.invalidateQueries({ queryKey: ["sa-leads"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const VisitCard = ({ v }: { v: RecordWithId }) => {
    const diff = daysFrom(today, v);
    const tone = diff < 0 ? "border-red-300 bg-red-500/5" : diff === 0 ? "border-amber-400 bg-amber-500/5" : diff === 1 ? "border-blue-300 bg-blue-500/5" : "border-border bg-card";
    const when = diff < 0 ? `${-diff} day${diff === -1 ? "" : "s"} overdue` : diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : `In ${diff} days`;
    const whenTone = diff < 0 ? "bg-red-500/15 text-red-600" : diff === 0 ? "bg-amber-500/20 text-amber-700" : diff === 1 ? "bg-blue-500/15 text-blue-600" : "bg-muted text-muted-foreground";
    return (
      <div className={`rounded-xl border p-3.5 flex flex-col gap-2 ${tone}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">{String(v.CustomerName)}</div>
            <div className="text-xs text-muted-foreground">{String(v.LeadUid)}{v.Mobile ? <> · <a href={`tel:${v.Mobile}`} className="hover:text-primary">{String(v.Mobile)}</a></> : null}</div>
          </div>
          <span className={`shrink-0 text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full ${whenTone}`}>{when}</span>
        </div>
        <div className="text-xs text-foreground">
          {fmtDay(v.PreferredDate)}{v.PreferredTime ? `, ${String(v.PreferredTime).slice(0, 5)}` : ""}{v.ProjectName ? ` · ${v.ProjectName}` : ""}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {StatusCell(v.Status)}
          {v.PickupRequired === "Yes" && <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 font-medium">Pickup needed</span>}
          <span>{v.ExecutiveName ? `with ${v.ExecutiveName}` : "No executive assigned"}</span>
        </div>
        {v.CustomerNotes ? <p className="text-xs text-muted-foreground line-clamp-2">{String(v.CustomerNotes)}</p> : null}
        {canEdit && (
          <div className="flex flex-wrap gap-1.5 pt-1 mt-auto">
            {v.Status === "Scheduled" && (
              <button onClick={() => setStatus(v, "Confirmed")} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-xs hover:bg-muted"><PhoneCall size={12} /> Confirmed</button>
            )}
            <button onClick={() => setStatus(v, "Completed")} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-emerald-300 text-emerald-700 text-xs hover:bg-emerald-50"><CheckCircle2 size={12} /> Visited</button>
            <button onClick={() => setStatus(v, "Cancelled")} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-muted-foreground text-xs hover:bg-muted"><XCircle size={12} /> Cancel</button>
          </div>
        )}
      </div>
    );
  };

  const CardGrid = ({ rows, empty }: { rows: RecordWithId[]; empty: string }) =>
    rows.length === 0
      ? <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground text-sm">{empty}</div>
      : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{rows.map((v) => <VisitCard key={String(v._id)} v={v} />)}</div>;

  return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Engagement", "Site Visits"]} title="Site Visits"
      subtitle={`${todayCount} today · ${upcoming.length} coming up${overdueVisits.length ? ` · ${overdueVisits.length} overdue` : ""}${unscheduled ? ` · ${unscheduled} without a date` : ""}`}
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <div className="space-y-5">
        <SaTabs
          tabs={[
            { key: "upcoming", icon: CalendarClock, label: `Upcoming (${upcoming.length})` },
            { key: "overdue", icon: AlertTriangle, label: `Overdue (${overdueVisits.length})` },
            { key: "list", icon: LayoutList, label: `All visits (${mappedData.length})` },
          ]}
          active={activeTab}
          onChange={(key) => setActiveTab(key as typeof activeTab)}
        />

        {activeTab === "upcoming" && (
          <CardGrid rows={upcoming} empty="No visits coming up. Schedule one from All visits → New Entry." />
        )}
        {activeTab === "overdue" && (
          <CardGrid rows={overdueVisits} empty="Nothing overdue — every past visit has been marked." />
        )}

        {activeTab === "list" && <MasterPage
          title="Site Visit"
          fields={fields}
          columns={columns}
          collapsibleAddForm
          gridCols={3}
          columnRenderers={{
            CustomerName: (v, r) => TitleCell(v, [r.LeadUid, r.Mobile].filter(Boolean).join(" · ")),
            PreferredDate: (v, r) => (
              <span className={`whitespace-nowrap ${r.PreferredDate && daysFrom(today, r) < 0 && !CLOSED.includes(String(r.Status)) ? "text-red-600 font-medium" : ""}`}>
                {fmtDay(v)}{r.PreferredTime ? `, ${String(r.PreferredTime).slice(0, 5)}` : ""}
              </span>
            ),
            Status: (v) => StatusCell(v),
          }}
          canCreate={canDoAction("sa-site-visits", "create")}
          canEdit={canDoAction("sa-site-visits", "edit")}
          canDelete={canDoAction("sa-site-visits", "delete")}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{ title: "Site Visits", filename: "site-visits", columns: exportColumns }}
          viewConfig={{
            title: "Site Visit Details",
            fields: [
              { key: "LeadUid", label: "Lead ID" },
              { key: "CustomerName", label: "Customer" },
              { key: "Mobile", label: "Mobile" },
              { key: "ProjectName", label: "Project" },
              { key: "PreferredDate", label: "Visit Date", render: (v) => <p className="text-sm">{fmtDay(v)}</p> },
              { key: "PreferredTime", label: "Time" },
              { key: "ExecutiveName", label: "Executive" },
              { key: "PickupRequired", label: "Pickup Needed" },
              { key: "CustomerNotes", label: "Customer Notes" },
              { key: "Status", label: "Status", render: (v) => StatusCell(v) },
            ],
          }}
        />}
      </div>
    </SalesAutoShell>
  );
};

export default SaSiteVisits;