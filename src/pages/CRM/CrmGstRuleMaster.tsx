import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { MasterPage, type DataChangeEvent, type RecordWithId, type FieldDef } from "@/components/MasterPage";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/crm-gst-rule";

// A rule picks WHICH HSN governs an amount; the rate itself is on the HSN row
// (HSN Master). Matching: same "Applies to", amount inside the band (Min
// exclusive, Max inclusive), the land / usage qualifiers ("Any" matches
// everything), most specific rule first, then Priority.
type Options = { appliesTo: string[]; hsn: { code: string; label: string }[] };

let optionsPromise: Promise<Options> | null = null;
const loadOptions = () => {
  optionsPromise ??= fetchWithAuth(`${API}/options`)
    .then((r) => (r.ok ? r.json() : { appliesTo: [], hsn: [] }))
    .catch(() => ({ appliesTo: [], hsn: [] }));
  return optionsPromise;
};

// Tri-state qualifiers: "" = Any (NULL), "1" / "0".
const fields: FieldDef[] = [
  { name: "Name", label: "Rule Name", type: "text", required: true },
  {
    name: "AppliesTo",
    label: "Applies To",
    type: "select",
    required: true,
    asyncOptions: async () => (await loadOptions()).appliesTo.map((a) => ({ value: a, label: a })),
  },
  {
    name: "HsnCode",
    label: "HSN (rate comes from HSN Master)",
    type: "select",
    required: true,
    asyncOptions: async () => (await loadOptions()).hsn.map((h) => ({ value: h.code, label: h.label })),
  },
  { name: "MinValue", label: "Band — above (₹, blank = no lower limit)", type: "number" },
  { name: "MaxValue", label: "Band — up to and including (₹, blank = no upper limit)", type: "number" },
  {
    name: "ForCommercial",
    label: "Unit usage",
    type: "select",
    asyncOptions: async () => [
      { value: "", label: "Any usage" },
      { value: "1", label: "Commercial units only" },
      { value: "0", label: "Residential units only" },
    ],
  },
  {
    name: "LandOwnedByCustomer",
    label: "Land owned by customer",
    type: "select",
    asyncOptions: async () => [
      { value: "", label: "Doesn't matter" },
      { value: "1", label: "Yes" },
      { value: "0", label: "No" },
    ],
  },
  { name: "Priority", label: "Priority (lower wins)", type: "number", defaultValue: "100" },
  { name: "Notes", label: "Notes", type: "text", fullWidth: true },
  { name: "IsActive", label: "Status", type: "toggle", defaultValue: true },
];

const columns = [
  { key: "Name", label: "Rule" },
  { key: "AppliesTo", label: "Applies To" },
  { key: "BandText", label: "Band", sortable: false },
  { key: "UsageText", label: "Usage" },
  { key: "HsnText", label: "HSN / Rate" },
  { key: "Priority", label: "Priority", hideOnMobile: true },
  { key: "IsActive", label: "Status" },
];

const inr = (v: unknown) => `₹${Number(v).toLocaleString("en-IN")}`;
const tri = (v: unknown) => (v === true || v === 1 ? "1" : v === false || v === 0 ? "0" : "");

async function fetchRules(): Promise<RecordWithId[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to load GST rules");
  const data = await res.json().catch(() => []);
  return (Array.isArray(data) ? data : []).map((r: any) => ({
    ...r,
    id: r.Id,
    MinValue: r.MinValue ?? "",
    MaxValue: r.MaxValue ?? "",
    ForCommercial: tri(r.ForCommercial),
    LandOwnedByCustomer: tri(r.LandOwnedByCustomer),
    BandText:
      r.MinValue == null && r.MaxValue == null
        ? "Any amount"
        : [r.MinValue != null ? `above ${inr(r.MinValue)}` : null, r.MaxValue != null ? `up to ${inr(r.MaxValue)}` : null]
            .filter(Boolean)
            .join(", "),
    UsageText: r.ForCommercial === true ? "Commercial" : r.ForCommercial === false ? "Residential" : "Any",
    HsnText: r.HsnCode ? `${r.HsnCode}${r.HsnRate != null ? ` · ${Number(r.HsnRate)}%` : " · not in HSN Master"}` : "—",
  }));
}

const CrmGstRuleMaster: React.FC = () => {
  const rights = usePageRights("crm-gst-rule-master");
  const queryClient = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["crm-gst-rules"], queryFn: fetchRules, staleTime: 60 * 1000 });

  const send = async (url: string, method: string, record?: Record<string, unknown>) => {
    const res = await fetchWithAuth(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: record ? JSON.stringify(record) : undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Request failed");
  };

  const handleChange = async (e: DataChangeEvent) => {
    try {
      if (e.action === "add") { await send(API, "POST", e.record); toast.success("GST rule created"); }
      else if (e.action === "update") { await send(`${API}/${e.id}`, "PUT", e.record); toast.success("GST rule updated"); }
      else if (e.action === "delete") { await send(`${API}/${e.id}`, "DELETE"); toast.success("GST rule retired"); }
      queryClient.invalidateQueries({ queryKey: ["crm-gst-rules"] });
    } catch (err: any) {
      toast.error(err.message || "Something went wrong");
    }
  };

  return (
    <>
      <Breadcrumbs items={["CRM", "Setup", "GST Rules"]} />
      <MasterPage
        title="GST Rule"
        canCreate={rights.canCreate}
        canEdit={rights.canEdit}
        canDelete={rights.canDelete}
        fields={fields}
        columns={columns}
        initialData={rows}
        loading={isLoading}
        onDataEvent={handleChange}
        viewConfig={{
          title: "GST Rule",
          fields: [
            { key: "Name", label: "Rule" },
            { key: "AppliesTo", label: "Applies To" },
            { key: "BandText", label: "Band" },
            { key: "UsageText", label: "Unit usage" },
            { key: "HsnText", label: "HSN / Rate" },
            { key: "Priority", label: "Priority" },
            { key: "Notes", label: "Notes" },
            { key: "IsActive", label: "Status" },
          ],
        }}
      />
    </>
  );
};

export default CrmGstRuleMaster;
