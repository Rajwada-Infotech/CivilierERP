import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { MasterPage, type DataChangeEvent, type RecordWithId, type FieldDef } from "@/components/MasterPage";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { KEY_LINE, RULE } from "./customers/config";

const API = "/api/crm-gst-rule";
const NUM = "font-heading tabular-nums";

// A rule picks WHICH HSN governs an amount; the rate itself is on the HSN row (HSN Master). Matching: same "Applies
// to", amount inside the band (Min exclusive, Max inclusive), the land / usage qualifiers ("Any" matches everything),
// most specific rule first, then Priority.
type Options = { appliesTo: string[]; hsn: { code: string; label: string }[]; coverage?: { commercialUnits: number; commercialRules: number } | null };

async function fetchOptions(): Promise<Options> {
  const r = await fetchWithAuth(`${API}/options`);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || "Could not load the GST rule options");
  return body;
}
const OPTIONS_KEY = ["crm-gst-rules", "options"];

const inr = (v: unknown) => `₹${Number(v).toLocaleString("en-IN")}`;
const tri = (v: unknown) => (v === true || v === 1 ? "1" : v === false || v === 0 ? "0" : "");

async function fetchRules(): Promise<RecordWithId[]> {
  const res = await fetchWithAuth(API);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || "Failed to load GST rules");
  return (Array.isArray(body) ? body : []).map((r: any) => ({
    ...r,
    id: r.Id,
    MinValue: r.MinValue ?? "",
    MaxValue: r.MaxValue ?? "",
    ForCommercial: tri(r.ForCommercial),
    LandOwnedByCustomer: tri(r.LandOwnedByCustomer),
    BandText:
      r.MinValue == null && r.MaxValue == null
        ? "Any amount"
        : [r.MinValue != null ? `above ${inr(r.MinValue)}` : null, r.MaxValue != null ? `up to ${inr(r.MaxValue)}` : null].filter(Boolean).join(", "),
    StatusText: r.IsActive ? "Active" : "Retired",
    UsageText: r.ForCommercial === true ? "Commercial" : r.ForCommercial === false ? "Residential" : "Any",
    // Shown now: two rules differing only here used to look identical.
    LandText: r.LandOwnedByCustomer === true ? "Customer's land" : r.LandOwnedByCustomer === false ? "Not the customer's" : "Any",
    HsnText: r.HsnCode ? `${r.HsnCode}${r.HsnRate != null ? ` · ${Number(r.HsnRate)}%` : ""}` : "—",
    HsnMissing: !!r.HsnCode && r.HsnRate == null,
  }));
}

const columns = [
  { key: "Name", label: "Rule" },
  { key: "AppliesTo", label: "Applies to" },
  { key: "BandText", label: "Band", sortable: false },
  { key: "UsageText", label: "Usage" },
  { key: "LandText", label: "Land", hideOnMobile: true },
  { key: "HsnText", label: "HSN · rate" },
  { key: "Priority", label: "Priority", hideOnMobile: true },
  { key: "StatusText", label: "Status" },
];

const CrmGstRuleMaster: React.FC = () => {
  const rights = usePageRights("crm-gst-rule-master");
  const queryClient = useQueryClient();
  const { data: rows = [], isLoading, isError, error, isFetching, refetch } = useQuery({ queryKey: ["crm-gst-rules"], queryFn: fetchRules, staleTime: 60 * 1000 });
  // One load for the pickers and the coverage check (it used to be fetched twice). It was cached for the whole
  // session, failures included, so a failed load left both pickers empty and a new HSN never appeared.
  const { data: options, isError: optionsFailed } = useQuery({ queryKey: OPTIONS_KEY, queryFn: fetchOptions, staleTime: 60 * 1000 });
  const coverage = options?.coverage;
  const loadOptions = () => queryClient.fetchQuery({ queryKey: OPTIONS_KEY, queryFn: fetchOptions, staleTime: 60 * 1000 }).catch(() => ({ appliesTo: [], hsn: [] } as Options));

  // Tri-state qualifiers: "" = Any (NULL), "1" / "0".
  const fields: FieldDef[] = React.useMemo(() => [
    { name: "Name", label: "Rule name", type: "text", required: true },
    { name: "AppliesTo", label: "Applies to", type: "select", required: true, asyncOptions: async () => (await loadOptions()).appliesTo.map((a) => ({ value: a, label: a })) },
    { name: "HsnCode", label: "HSN (the rate comes from HSN Master)", type: "select", required: true, asyncOptions: async () => (await loadOptions()).hsn.map((h) => ({ value: h.code, label: h.label })) },
    { name: "MinValue", label: "Band — above ₹ (blank = no lower limit)", type: "number" },
    { name: "MaxValue", label: "Band — up to and including ₹ (blank = no upper limit)", type: "number" },
    {
      name: "ForCommercial", label: "Unit usage", type: "select",
      asyncOptions: async () => [{ value: "", label: "Any usage" }, { value: "1", label: "Commercial units only" }, { value: "0", label: "Residential units only" }],
    },
    {
      name: "LandOwnedByCustomer", label: "Land owned by customer", type: "select",
      asyncOptions: async () => [{ value: "", label: "Doesn't matter" }, { value: "1", label: "Yes" }, { value: "0", label: "No" }],
    },
    { name: "Priority", label: "Priority (lower wins)", type: "number", defaultValue: "100" },
    { name: "Notes", label: "Notes", type: "text", fullWidth: true },
    { name: "IsActive", label: "Status", type: "toggle", defaultValue: true },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const send = async (url: string, method: string, record?: Record<string, unknown>) => {
    const res = await fetchWithAuth(url, { method, headers: { "Content-Type": "application/json" }, body: record ? JSON.stringify(record) : undefined });
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

  const active = rows.filter((r) => r.IsActive).length;
  const categories = new Set(rows.filter((r) => r.IsActive).map((r) => r.AppliesTo)).size;
  const missingHsn = rows.filter((r) => r.IsActive && r.HsnMissing).length;
  const figures = [
    { label: "Rules", value: rows.length, note: "in all" },
    { label: "Active", value: active, note: `across ${categories} supply categor${categories === 1 ? "y" : "ies"}` },
    { label: "HSN not in master", value: missingHsn, note: "active rules with no rate to apply", red: missingHsn > 0 },
    { label: "Retired", value: rows.length - active, note: "kept — they taxed past bookings" },
  ];
  const statusMark = (v: unknown) => <SheetMark text={v ? "Active" : "Retired"} tone={v ? "done" : "draft"} />;

  return (
    <>
      <Breadcrumbs items={["CRM", "Setup", "GST Rules"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Setup"
        title="GST rules"
        subtitle="Which HSN taxes a sale: by what it is, its amount band, residential or commercial, and whose land it stands on. The rate itself lives on the HSN in HSN Master. The most specific matching rule wins, then the lower priority."
        action={<button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>}
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
            {figures.map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>{isLoading ? "…" : x.value.toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        {coverage && coverage.commercialUnits > 0 && coverage.commercialRules === 0 && (
          <div className="px-4 py-2.5 text-xs bg-card" style={{ border: RULE, boxShadow: "inset 3px 0 0 hsl(var(--destructive))" }}>
            <span className={NUM}>{coverage.commercialUnits}</span> commercial unit(s) (shops / offices) exist but no active rule is set for <b>Commercial units only</b> — they are
            being taxed with the residential rules. Add a rule with Unit usage = Commercial units only.
          </div>
        )}
        {optionsFailed && (
          <div className="px-4 py-2.5 text-xs text-destructive bg-card" style={{ border: "1px solid hsl(var(--destructive))" }}>
            The Applies to and HSN lists didn&apos;t load, so a rule can&apos;t be added or changed right now. Refresh to try again.
          </div>
        )}
        {isError ? (
          <div className="px-4 py-2.5 text-xs text-destructive bg-card" style={{ border: "1px solid hsl(var(--destructive))" }}>{(error as Error)?.message}</div>
        ) : (
          <MasterPage
            title="GST Rule"
            canCreate={rights.canCreate}
            canEdit={rights.canEdit}
            canDelete={rights.canDelete}
            fields={fields}
            columns={columns}
            columnRenderers={{
              Name: (v) => <span className="font-medium">{String(v ?? "")}</span>,
              AppliesTo: (v) => <span className={`${NUM} text-xs font-semibold`}>{String(v ?? "")}</span>,
              BandText: (v) => <span className={`${NUM} text-xs`}>{String(v ?? "")}</span>,
              HsnText: (v, r) => r.HsnMissing
                ? <span className="text-xs text-destructive" title="This code isn't an active HSN in HSN Master — there is no rate to apply">{String(r.HsnCode)} · not in HSN Master</span>
                : <span className={`${NUM} text-xs`}>{String(v ?? "")}</span>,
              Priority: (v) => <span className={`${NUM} text-xs`}>{String(v ?? "")}</span>,
              StatusText: (_v, r) => statusMark(r.IsActive),
            }}
            initialData={rows}
            loading={isLoading}
            onDataEvent={handleChange}
            viewConfig={{
              title: "GST Rule",
              fields: [
                { key: "Name", label: "Rule" },
                { key: "AppliesTo", label: "Applies to" },
                { key: "BandText", label: "Band" },
                { key: "UsageText", label: "Unit usage" },
                { key: "LandText", label: "Land owned by customer" },
                { key: "HsnText", label: "HSN · rate" },
                { key: "Priority", label: "Priority" },
                { key: "Notes", label: "Notes" },
                { key: "IsActive", label: "Status", render: (v) => statusMark(v) },
              ],
            }}
          />
        )}
      </SheetShell>
    </>
  );
};

export default CrmGstRuleMaster;
