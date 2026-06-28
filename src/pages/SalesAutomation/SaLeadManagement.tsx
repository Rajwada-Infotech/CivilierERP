import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, type DataChangeEvent, type RecordWithId, type FieldDef } from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { CheckCircle2, IndianRupee } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/sa/leads";

async function fetchLeads(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch leads");
  return res.json();
}
async function fetchUserOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth(`${API}/users`);
  if (!res.ok) throw new Error("Failed to fetch users");
  const data: { Id: number; Name: string; role: string }[] = await res.json();
  return data.map((u) => ({ value: String(u.Id), label: `${u.Name} (${u.role})` }));
}
async function fetchPlatformOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/sa/social-media");
  if (!res.ok) return [];
  const data: { Id: number; Name: string }[] = await res.json();
  return data.map((p) => ({ value: String(p.Id), label: p.Name }));
}
async function fetchCampaignOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/sa/campaigns");
  if (!res.ok) return [];
  const data: { Id: number; Name: string; CampaignCode: string }[] = await res.json();
  return data.map((c) => ({ value: String(c.Id), label: `${c.CampaignCode} - ${c.Name}` }));
}
async function fetchAdOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/sa/ads");
  if (!res.ok) return [];
  const data: { Id: number; Name: string }[] = await res.json();
  return data.map((a) => ({ value: String(a.Id), label: a.Name }));
}

const fields: FieldDef[] = [
  { name: "CustomerName", label: "Customer Name", type: "text", required: true },
  { name: "Mobile", label: "Mobile Number", type: "text", required: true },
  { name: "AltMobile", label: "Alternate Mobile", type: "text" },
  { name: "Email", label: "Email", type: "text" },
  { name: "DateGenerated", label: "Date Generated", type: "date" },
  { name: "PlatformId", label: "Source Platform", type: "select", asyncOptions: fetchPlatformOptions },
  { name: "CampaignId", label: "Campaign", type: "select", asyncOptions: fetchCampaignOptions },
  { name: "AdId", label: "Advertisement", type: "select", asyncOptions: fetchAdOptions },
  { name: "AssignedTeamLeadId", label: "Assigned Team Lead", type: "select", asyncOptions: fetchUserOptions },
  { name: "AssignedSalespersonId", label: "Assigned Salesperson", type: "select", asyncOptions: fetchUserOptions },
  { name: "Status", label: "Lead Status", type: "select", options: ["New","Assigned","Contacted","FollowUp","VisitScheduled","Visited","Booking","Lost"], defaultValue: "New" },
  { name: "Classification", label: "Classification", type: "select", options: ["Hot","Warm","Cold","NotInterested","CallBackLater"] },
  { name: "CustomerRemarks", label: "Customer Remarks", type: "textarea", fullWidth: true },
];

const columns = [
  { key: "LeadUid", label: "Lead ID" },
  { key: "CustomerName", label: "Customer Name" },
  { key: "Mobile", label: "Mobile" },
  { key: "PlatformName", label: "Source", hideOnMobile: true },
  { key: "CampaignName", label: "Campaign", hideOnMobile: true },
  { key: "Status", label: "Status" },
  { key: "Classification", label: "Classification", hideOnMobile: true },
  { key: "SalespersonName", label: "Salesperson", hideOnMobile: true },
];

const exportColumns: ExportColumn[] = [
  { header: "Lead ID", accessor: "LeadUid" },
  { header: "Customer Name", accessor: "CustomerName" },
  { header: "Mobile", accessor: "Mobile" },
  { header: "Email", accessor: "Email" },
  { header: "Source", accessor: "PlatformName" },
  { header: "Campaign", accessor: "CampaignName" },
  { header: "Ad", accessor: "AdName" },
  { header: "Date Generated", accessor: "DateGenerated" },
  { header: "Status", accessor: "Status" },
  { header: "Classification", accessor: "Classification" },
  { header: "Team Lead", accessor: "TeamLeadName" },
  { header: "Salesperson", accessor: "SalespersonName" },
];

const SaLeadManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [bookingLead, setBookingLead] = useState<RecordWithId | null>(null);
  const [bookingForm, setBookingForm] = useState({
    UnitNo: "",
    BlockName: "",
    FloorName: "",
    UnitType: "",
    AreaSqFt: "",
    RatePerSqFt: "",
    TotalValue: "",
    BookingAmount: "",
    BookingDate: new Date().toISOString().slice(0, 10),
    PaymentMode: "",
  });
  const [handoffLoading, setHandoffLoading] = useState<string | null>(null);
  const { data: leads, isLoading, error } = useQuery({ queryKey: ["sa-leads"], queryFn: fetchLeads, staleTime: 2 * 60 * 1000 });

  const mappedData: RecordWithId[] = useMemo(() => {
    if (!Array.isArray(leads)) return [];
    return leads.map((l) => ({
      _id: String(l.Id),
      LeadUid: l.LeadUid ?? "",
      CustomerName: l.CustomerName ?? "",
      Mobile: l.Mobile ?? "",
      AltMobile: l.AltMobile ?? "",
      Email: l.Email ?? "",
      DateGenerated: l.DateGenerated ? String(l.DateGenerated).slice(0, 10) : "",
      PlatformId: String(l.PlatformId ?? ""),
      PlatformName: l.PlatformName ?? "",
      CampaignId: String(l.CampaignId ?? ""),
      CampaignName: l.CampaignName ?? "",
      AdId: String(l.AdId ?? ""),
      AdName: l.AdName ?? "",
      Status: l.Status ?? "New",
      Classification: l.Classification ?? "",
      CustomerRemarks: l.CustomerRemarks ?? "",
      AssignedTeamLeadId: String(l.AssignedTeamLeadId ?? ""),
      TeamLeadName: l.TeamLeadName ?? "",
      AssignedSalespersonId: String(l.AssignedSalespersonId ?? ""),
      SalespersonName: l.SalespersonName ?? "",
      FollowupCustomerId: l.FollowupCustomerId ?? "",
      BookingId: l.BookingId ?? "",
    }));
  }, [leads]);

  const toPayload = (r: Record<string, any>) => ({
    CustomerName: r.CustomerName?.trim() || null,
    Mobile: r.Mobile?.trim() || null,
    AltMobile: r.AltMobile || null,
    Email: r.Email || null,
    DateGenerated: r.DateGenerated || null,
    PlatformId: r.PlatformId ? parseInt(r.PlatformId) : null,
    CampaignId: r.CampaignId ? parseInt(r.CampaignId) : null,
    AdId: r.AdId ? parseInt(r.AdId) : null,
    Status: r.Status || "New",
    Classification: r.Classification || null,
    CustomerRemarks: r.CustomerRemarks || null,
    AssignedTeamLeadId: r.AssignedTeamLeadId ? parseInt(r.AssignedTeamLeadId) : null,
    AssignedSalespersonId: r.AssignedSalespersonId ? parseInt(r.AssignedSalespersonId) : null,
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        const res = await fetchWithAuth(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toPayload(event.record)) });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to add lead");
        toast.success("Lead added!");
      }
      if (event.action === "update") {
        const res = await fetchWithAuth(`${API}/${event.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toPayload(event.record)) });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to update lead");
        toast.success("Lead updated!");
      }
      if (event.action === "delete") {
        const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to delete lead");
        toast.success("Lead deleted!");
      }
      await queryClient.invalidateQueries({ queryKey: ["sa-leads"] });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  const invalidateLeadFlow = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sa-leads"] }),
      queryClient.invalidateQueries({ queryKey: ["sa-dashboard-sales"] }),
      queryClient.invalidateQueries({ queryKey: ["sa-dashboard-marketing"] }),
      queryClient.invalidateQueries({ queryKey: ["sa-report"] }),
    ]);
  };

  const promoteToFollowup = async (row: RecordWithId) => {
    setHandoffLoading(`followup-${row._id}`);
    try {
      const res = await fetchWithAuth(`${API}/${row._id}/promote-followup`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to promote lead to follow-up");
      toast.success(data.message || "Lead promoted to follow-up");
      await invalidateLeadFlow();
    } catch (err: any) {
      toast.error(err.message || "Failed to promote lead");
    } finally {
      setHandoffLoading(null);
    }
  };

  const resetBookingForm = () => {
    setBookingForm({
      UnitNo: "",
      BlockName: "",
      FloorName: "",
      UnitType: "",
      AreaSqFt: "",
      RatePerSqFt: "",
      TotalValue: "",
      BookingAmount: "",
      BookingDate: new Date().toISOString().slice(0, 10),
      PaymentMode: "",
    });
  };

  const openBookingDialog = (row: RecordWithId) => {
    setBookingLead(row);
    setBookingForm((current) => ({
      ...current,
      BookingDate: new Date().toISOString().slice(0, 10),
    }));
  };

  const promoteToBooking = async () => {
    if (!bookingLead) return;
    if (!bookingForm.UnitNo.trim()) return toast.error("Unit No is required");
    setHandoffLoading(`booking-${bookingLead._id}`);
    try {
      const payload = {
        UnitNo: bookingForm.UnitNo.trim(),
        BlockName: bookingForm.BlockName || null,
        FloorName: bookingForm.FloorName || null,
        UnitType: bookingForm.UnitType || null,
        AreaSqFt: bookingForm.AreaSqFt ? parseFloat(bookingForm.AreaSqFt) : null,
        RatePerSqFt: bookingForm.RatePerSqFt ? parseFloat(bookingForm.RatePerSqFt) : null,
        TotalValue: bookingForm.TotalValue ? parseFloat(bookingForm.TotalValue) : null,
        BookingAmount: bookingForm.BookingAmount ? parseFloat(bookingForm.BookingAmount) : 0,
        BookingDate: bookingForm.BookingDate || new Date().toISOString().slice(0, 10),
        PaymentMode: bookingForm.PaymentMode || null,
      };
      const res = await fetchWithAuth(`${API}/${bookingLead._id}/promote-booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to promote lead to booking");
      toast.success(data.message || "Lead promoted to booking");
      setBookingLead(null);
      resetBookingForm();
      await invalidateLeadFlow();
    } catch (err: any) {
      toast.error(err.message || "Failed to promote lead to booking");
    } finally {
      setHandoffLoading(null);
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading leads...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load leads.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Sales Automation", "Lead Management"]} />
      <div className="space-y-8 mt-6">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground">Lead Management</h1>
          <p className="text-xs text-muted-foreground mt-0.5">All leads generated from advertisements — track, assign and manage the complete lead lifecycle</p>
        </div>
        <MasterPage
          title="Lead"
          fields={fields}
          columns={columns}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{ title: "Lead Management", filename: "lead-management", columns: exportColumns }}
          rowActions={(row) => {
            const hasFollowup = Boolean(row.FollowupCustomerId);
            const hasBooking = Boolean(row.BookingId);
            if (hasBooking) {
              return (
                <span className="px-2 py-1 text-[10px] font-medium rounded-full bg-emerald-500/10 text-emerald-600">
                  Booked
                </span>
              );
            }
            return (
              <>
                {!hasFollowup && (
                  <button
                    type="button"
                    onClick={() => promoteToFollowup(row)}
                    disabled={handoffLoading === `followup-${row._id}`}
                    className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                    title="Promote to follow-up"
                  >
                    <CheckCircle2 size={13} />
                  </button>
                )}
                {hasFollowup && (
                  <button
                    type="button"
                    onClick={() => openBookingDialog(row)}
                    disabled={handoffLoading === `booking-${row._id}`}
                    className="p-1.5 rounded-lg text-amber-500 hover:bg-amber-500/10 transition-colors disabled:opacity-40"
                    title="Promote to booking"
                  >
                    <IndianRupee size={13} />
                  </button>
                )}
              </>
            );
          }}
          viewConfig={{
            title: "Lead Details",
            fields: [
              { key: "LeadUid", label: "Lead ID" },
              { key: "CustomerName", label: "Customer Name" },
              { key: "Mobile", label: "Mobile" },
              { key: "AltMobile", label: "Alternate Mobile" },
              { key: "Email", label: "Email" },
              { key: "PlatformName", label: "Source Platform" },
              { key: "CampaignName", label: "Campaign" },
              { key: "AdName", label: "Advertisement" },
              { key: "DateGenerated", label: "Date Generated" },
              { key: "Status", label: "Status" },
              { key: "Classification", label: "Classification" },
              { key: "TeamLeadName", label: "Team Lead" },
              { key: "SalespersonName", label: "Salesperson" },
              { key: "FollowupCustomerId", label: "Follow-up Customer ID" },
              { key: "BookingId", label: "Booking ID" },
              { key: "CustomerRemarks", label: "Remarks" },
            ],
          }}
        />
        <Dialog open={!!bookingLead} onOpenChange={(open) => {
          if (!open) {
            setBookingLead(null);
            resetBookingForm();
          }
        }}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle className="font-heading text-base">Promote Lead to Booking</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {bookingLead && (
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-sm font-medium text-foreground">{String(bookingLead.CustomerName ?? "")}</p>
                  <p className="text-xs text-muted-foreground">{String(bookingLead.LeadUid ?? "")} · {String(bookingLead.Mobile ?? "")}</p>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  ["UnitNo", "Unit No", "text", true],
                  ["BlockName", "Block", "text", false],
                  ["FloorName", "Floor", "text", false],
                  ["UnitType", "Unit Type", "text", false],
                  ["AreaSqFt", "Area Sq Ft", "number", false],
                  ["RatePerSqFt", "Rate Per Sq Ft", "number", false],
                  ["TotalValue", "Total Value", "number", false],
                  ["BookingAmount", "Booking Amount", "number", false],
                  ["BookingDate", "Booking Date", "date", false],
                  ["PaymentMode", "Payment Mode", "text", false],
                ].map(([key, label, type, required]) => (
                  <div key={String(key)}>
                    <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                      {label}{required && <span className="text-destructive ml-0.5">*</span>}
                    </label>
                    <input
                      type={String(type)}
                      value={bookingForm[key as keyof typeof bookingForm]}
                      onChange={(e) => setBookingForm((current) => ({ ...current, [String(key)]: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    setBookingLead(null);
                    resetBookingForm();
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={promoteToBooking}
                  disabled={handoffLoading === `booking-${bookingLead?._id}`}
                  className="px-4 py-1.5 rounded-lg text-xs font-heading font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                >
                  {handoffLoading === `booking-${bookingLead?._id}` ? "Promoting..." : "Promote"}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
};

export default SaLeadManagement;
