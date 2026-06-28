import React, { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, type DataChangeEvent, type RecordWithId, type FieldDef } from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/sa/site-visits";

async function fetchVisits(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch site visits");
  return res.json();
}
async function fetchLeadOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/sa/leads");
  if (!res.ok) return [];
  const data: any[] = await res.json();
  return data.map((l) => ({ value: String(l.Id), label: `${l.LeadUid} - ${l.CustomerName} (${l.Mobile})` }));
}
async function fetchUserOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/sa/leads/users");
  if (!res.ok) return [];
  const data: any[] = await res.json();
  return data.map((u) => ({ value: String(u.Id), label: `${u.Name} (${u.role})` }));
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
  const queryClient = useQueryClient();
  const { data: visits, isLoading, error } = useQuery({ queryKey: ["sa-site-visits"], queryFn: fetchVisits, staleTime: 2 * 60_000 });

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

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Sales Automation", "Site Visits"]} />
      <div className="space-y-8 mt-6">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground">Site Visitation</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Schedule and track customer site visits for interested leads</p>
        </div>
        <MasterPage
          title="Site Visit"
          fields={fields}
          columns={columns}
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
        />
      </div>
    </>
  );
};

export default SaSiteVisits;