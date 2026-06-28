import React, { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, type DataChangeEvent, type RecordWithId, type FieldDef } from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/sa/marketing-invoices";

async function fetchInvoices(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch invoices");
  return res.json();
}
async function fetchCampaignOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/sa/campaigns/dropdown");
  if (!res.ok) return [];
  const data: any[] = await res.json();
  return data.map((c) => ({ value: String(c.Id), label: `${c.CampaignCode} - ${c.Name}` }));
}
async function fetchAdOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/sa/ads/dropdown");
  if (!res.ok) return [];
  const data: any[] = await res.json();
  return data.map((a) => ({
    value: String(a.Id),
    label: [a.CampaignCode, a.Name].filter(Boolean).join(" - "),
  }));
}

const fields: FieldDef[] = [
  { name: "InvoiceNumber", label: "Invoice Number", type: "text", required: true },
  { name: "VendorName", label: "Vendor", type: "text" },
  { name: "CampaignId", label: "Campaign", type: "select", asyncOptions: fetchCampaignOptions },
  { name: "AdId", label: "Advertisement", type: "select", asyncOptions: fetchAdOptions },
  { name: "InvoiceDate", label: "Invoice Date", type: "date" },
  { name: "Amount", label: "Amount", type: "number" },
  { name: "GstAmount", label: "GST Amount", type: "number" },
  { name: "DueDate", label: "Due Date", type: "date" },
  { name: "PaymentStatus", label: "Payment Status", type: "select", options: ["Pending", "Paid", "Partial", "Cancelled"], defaultValue: "Pending" },
  { name: "Notes", label: "Notes", type: "textarea", fullWidth: true },
];

const columns = [
  { key: "InvoiceNumber", label: "Invoice #" },
  { key: "VendorName", label: "Vendor" },
  { key: "CampaignName", label: "Campaign", hideOnMobile: true },
  { key: "AdName", label: "Ad", hideOnMobile: true },
  { key: "Amount", label: "Amount" },
  { key: "GstAmount", label: "GST", hideOnMobile: true },
  { key: "TotalAmount", label: "Total" },
  { key: "PaymentStatus", label: "Status" },
  { key: "DueDate", label: "Due Date", hideOnMobile: true },
];

const exportColumns: ExportColumn[] = [
  { header: "Invoice #", accessor: "InvoiceNumber" },
  { header: "Vendor", accessor: "VendorName" },
  { header: "Campaign", accessor: "CampaignName" },
  { header: "Ad", accessor: "AdName" },
  { header: "Invoice Date", accessor: "InvoiceDate" },
  { header: "Amount", accessor: "Amount" },
  { header: "GST", accessor: "GstAmount" },
  { header: "Total", accessor: "TotalAmount" },
  { header: "Due Date", accessor: "DueDate" },
  { header: "Payment Status", accessor: "PaymentStatus" },
  { header: "Notes", accessor: "Notes" },
];

const SaMarketingInvoices: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: invoices, isLoading, error } = useQuery({ queryKey: ["sa-marketing-invoices"], queryFn: fetchInvoices, staleTime: 2 * 60_000 });

  const mappedData: RecordWithId[] = useMemo(() => {
    if (!Array.isArray(invoices)) return [];
    return invoices.map((i) => ({
      _id: String(i.Id),
      InvoiceNumber: i.InvoiceNumber ?? "",
      VendorName: i.VendorName ?? "",
      CampaignId: String(i.CampaignId ?? ""),
      CampaignName: i.CampaignName ?? "",
      AdId: String(i.AdId ?? ""),
      AdName: i.AdName ?? "",
      InvoiceDate: i.InvoiceDate ? String(i.InvoiceDate).slice(0, 10) : "",
      Amount: i.Amount ?? 0,
      GstAmount: i.GstAmount ?? 0,
      TotalAmount: i.TotalAmount ?? 0,
      DueDate: i.DueDate ? String(i.DueDate).slice(0, 10) : "",
      PaymentStatus: i.PaymentStatus ?? "Pending",
      Notes: i.Notes ?? "",
    }));
  }, [invoices]);

  const toPayload = (r: Record<string, any>) => ({
    InvoiceNumber: r.InvoiceNumber?.trim() || null,
    VendorName: r.VendorName || null,
    CampaignId: r.CampaignId ? parseInt(r.CampaignId) : null,
    AdId: r.AdId ? parseInt(r.AdId) : null,
    InvoiceDate: r.InvoiceDate || null,
    Amount: r.Amount ? parseFloat(r.Amount) : 0,
    GstAmount: r.GstAmount ? parseFloat(r.GstAmount) : 0,
    DueDate: r.DueDate || null,
    PaymentStatus: r.PaymentStatus || "Pending",
    Notes: r.Notes || null,
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        const res = await fetchWithAuth(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toPayload(event.record)) });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to add invoice");
        toast.success("Invoice added!");
      }
      if (event.action === "update") {
        const res = await fetchWithAuth(`${API}/${event.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toPayload(event.record)) });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to update invoice");
        toast.success("Invoice updated!");
      }
      if (event.action === "delete") {
        const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to delete invoice");
        toast.success("Invoice deleted!");
      }
      await queryClient.invalidateQueries({ queryKey: ["sa-marketing-invoices"] });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading invoices...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load invoices.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Sales Automation", "Marketing Invoices"]} />
      <div className="space-y-8 mt-6">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground">Marketing Invoices</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Track marketing expenses and invoice payments for campaigns and advertisements</p>
        </div>
        <MasterPage
          title="Invoice"
          fields={fields}
          columns={columns}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{ title: "Marketing Invoices", filename: "marketing-invoices", columns: exportColumns }}
          viewConfig={{
            title: "Invoice Details",
            fields: [
              { key: "InvoiceNumber", label: "Invoice #" },
              { key: "VendorName", label: "Vendor" },
              { key: "CampaignName", label: "Campaign" },
              { key: "AdName", label: "Advertisement" },
              { key: "InvoiceDate", label: "Invoice Date" },
              { key: "Amount", label: "Amount" },
              { key: "GstAmount", label: "GST" },
              { key: "TotalAmount", label: "Total" },
              { key: "DueDate", label: "Due Date" },
              { key: "PaymentStatus", label: "Payment Status" },
              { key: "Notes", label: "Notes" },
            ],
          }}
        />
      </div>
    </>
  );
};

export default SaMarketingInvoices;
