import React, { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { MasterPage, type DataChangeEvent, type RecordWithId, type FieldDef } from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { CalendarClock, LayoutList } from "lucide-react";

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
  { name: "PreferredTime", label: "Preferred Time", type: "text" },
  { name: "ExecutiveId", label: "Assigned Executive", type: "select", asyncOptions: fetchUserOptions },
  { name: "PickupRequired", label: "Pickup Required", type: "select", options: ["Yes", "No"], defaultValue: "No" },
  { name: "CustomerNotes", label: "Customer Notes", type: "textarea", fullWidth: true },
  { name: "Status", label: "Status", type: "select", options: ["Scheduled","Confirmed","Completed","Cancelled","Rescheduled"], defaultValue: "Scheduled" },
];

const columns = [
  { key: "LeadUid", label: "Lead ID" },
  { key: "CustomerName", label: "Customer" },
  { key: "Mobile", label: "Mobile", hideOnMobile: true },
  { key: "ProjectName", label: "Project", hideOnMobile: true },
  { key: "PreferredDate", label: "Visit Date" },
  { key: "PreferredTime", label: "Time", hideOnMobile: true },
  { key: "ExecutiveName", label: "Executive", hideOnMobile: true },
  { key: "Status", label: "Status" },
];

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
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"list" | "upcoming">("upcoming");
  const { data: visits, isLoading, error, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["sa-site-visits"], queryFn: fetchVisits, staleTime: 30_000 });

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
    try {
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
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading site visits...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load site visits.</div>;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const upcoming = mappedData.filter((v) => {
    if (!v.PreferredDate || v.Status === "Completed" || v.Status === "Cancelled") return false;
    return new Date(String(v.PreferredDate)) >= today;
  }).sort((a, b) => new Date(String(a.PreferredDate)).getTime() - new Date(String(b.PreferredDate)).getTime());

  const overdueVisits = mappedData.filter((v) => {
    if (!v.PreferredDate || v.Status === "Completed" || v.Status === "Cancelled") return false;
    return new Date(String(v.PreferredDate)) < today;
  });

  return (
    <SalesAutoShell title="Site Visitation" subtitle="Schedule and track customer site visits for interested leads"
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex gap-1 p-1 rounded-lg border border-border bg-muted/30">
            {([
              { key: "upcoming", icon: CalendarClock, label: "Upcoming" },
              { key: "list", icon: LayoutList, label: "All Visits" },
            ] as const).map(({ key, icon: Icon, label }) => (
              <button key={key} onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeTab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
        </div>

        {/* UPCOMING TAB */}
        {activeTab === "upcoming" && (
          <div className="space-y-4">
            {/* Overdue alert */}
            {overdueVisits.length > 0 && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 flex items-center gap-3">
                <span className="text-sm font-semibold text-red-600">{overdueVisits.length} overdue visit{overdueVisits.length > 1 ? "s" : ""}</span>
                <span className="text-xs text-muted-foreground">Past their scheduled date but not completed</span>
              </div>
            )}
            {upcoming.length === 0 ? (
              <div className="rounded-lg border border-border p-8 text-center text-muted-foreground text-sm">No upcoming site visits scheduled</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {upcoming.map((v) => {
                  const visitDate = new Date(String(v.PreferredDate));
                  const diffDays = Math.ceil((visitDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                  const isToday = diffDays === 0;
                  const isTomorrow = diffDays === 1;
                  const urgency = isToday ? "border-amber-400 bg-amber-500/5" : isTomorrow ? "border-blue-400 bg-blue-500/5" : "border-border bg-background";
                  return (
                    <div key={String(v._id)} className={`rounded-lg border p-3 space-y-2 ${urgency}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-foreground truncate">{String(v.CustomerName)}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isToday ? "bg-amber-500/20 text-amber-600" : isTomorrow ? "bg-blue-500/20 text-blue-600" : "bg-muted text-muted-foreground"}`}>
                          {isToday ? "TODAY" : isTomorrow ? "TOMORROW" : `in ${diffDays}d`}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">{String(v.Mobile)}</div>
                      <div className="text-xs text-muted-foreground">
                        {String(v.PreferredDate)} {v.PreferredTime ? `at ${String(v.PreferredTime).slice(0, 5)}` : ""}
                      </div>
                      {v.ProjectName && <div className="text-xs text-foreground font-medium">{String(v.ProjectName)}</div>}
                      {v.ExecutiveName && <div className="text-xs text-muted-foreground">Exec: {String(v.ExecutiveName)}</div>}
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${String(v.Status) === "Scheduled" ? "bg-blue-500/10 text-blue-600" : "bg-muted text-muted-foreground"}`}>{String(v.Status)}</span>
                        {String(v.PickupRequired) === "Yes" && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-semibold">Pickup</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ALL VISITS TAB */}
        {activeTab === "list" && <MasterPage
          title="Site Visit"
          fields={fields}
          columns={columns}
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
              { key: "PreferredDate", label: "Preferred Date" },
              { key: "PreferredTime", label: "Preferred Time" },
              { key: "ExecutiveName", label: "Executive" },
              { key: "PickupRequired", label: "Pickup Required" },
              { key: "CustomerNotes", label: "Customer Notes" },
              { key: "Status", label: "Status" },
            ],
          }}
        />}
      </div>
    </SalesAutoShell>
  );
};

export default SaSiteVisits;