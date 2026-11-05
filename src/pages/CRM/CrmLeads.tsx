// CRM Leads: leads marked Converted in Sales Automation, waiting to become CRM customers. Converting a lead never makes
// an application by itself: staff pick one here with Create Customer (CrmCustomers' New Customer dialog, ?leadId=X),
// which is the real Leads -> Customer step and is enforced again on the server (crmCustomers.js POST /). An
// application only comes later, from that customer, on Applications.
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ExternalLink, RefreshCw, UserPlus } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

interface PoolLead {
  Id: number;
  LeadUid: string;
  CustomerName: string;
  Mobile: string | null;
  Email: string | null;
  DateGenerated: string | null;
  SourceType: string | null;
  PropertyType: string | null;
  BhkPreference: string | null;
  PreferredLocation: string | null;
  BudgetMin: number | null;
  BudgetMax: number | null;
  SalespersonName: string | null;
  CustomerId: number | null;
  CustomerNo: string | null;
  CustomerCreatedAt: string | null;
}

const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const lakh = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : `₹${(n / 1e5).toFixed(1)} L`);
const budget = (l: PoolLead) => (l.BudgetMin || l.BudgetMax ? [l.BudgetMin, l.BudgetMax].filter(Boolean).map((n) => lakh(Number(n))).join(" – ") : "");
const daysSince = (d: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : null);

async function fetchPool(): Promise<PoolLead[]> {
  const res = await fetchWithAuth("/api/crm/leads");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Could not load the leads (${res.status}).`);
  return Array.isArray(body) ? body : [];
}

export default function CrmLeads() {
  const rights = usePageRights("crm-leads");
  const customerRights = usePageRights("crm-customers");
  const navigate = useNavigate();
  const [show, setShow] = useState<"waiting" | "made">("waiting");

  const { data: leads = [], isLoading, isError, error, isFetching, refetch } = useQuery({ queryKey: ["crm-leads-pool"], queryFn: fetchPool, staleTime: 30_000 });
  const waiting = useMemo(() => leads.filter((l) => !l.CustomerId), [leads]);
  const made = useMemo(() => leads.filter((l) => l.CustomerId), [leads]);
  const rows = show === "waiting" ? waiting : made;

  const thisMonth = new Date();
  thisMonth.setDate(1);
  const stats = [
    { label: "Waiting", value: waiting.length, note: "converted leads with no customer yet" },
    { label: "Waiting over a week", value: waiting.filter((l) => (daysSince(l.DateGenerated) ?? 0) > 7).length, note: "by the date the lead came in" },
    { label: "Made customers", value: made.length, note: "leads already turned into a CRM customer" },
    { label: "This month", value: made.filter((l) => l.CustomerCreatedAt && new Date(l.CustomerCreatedAt) >= thisMonth).length, note: "customers made from leads" },
  ];

  const columns: ColumnDef<PoolLead, unknown>[] = [
    {
      id: "lead",
      accessorFn: (l) => l.LeadUid,
      header: "Lead",
      size: 170,
      cell: ({ row: { original: l } }) => {
        const age = daysSince(l.DateGenerated);
        return (
          <div className="leading-tight">
            <p className="font-heading tabular-nums text-xs">{l.LeadUid}</p>
            <p className="text-[0.6875rem] text-muted-foreground">
              {fmtDate(l.DateGenerated)}
              {show === "waiting" && age != null ? ` · ${age === 0 ? "today" : `${age} day${age === 1 ? "" : "s"}`}` : ""}
            </p>
          </div>
        );
      },
    },
    {
      id: "person",
      accessorFn: (l) => `${l.CustomerName} ${l.Mobile ?? ""} ${l.Email ?? ""}`,
      header: "Person",
      size: 220,
      cell: ({ row: { original: l } }) => (
        <div className="leading-tight min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{l.CustomerName}</p>
          <p className="text-[0.6875rem] text-muted-foreground truncate">{[l.Mobile, l.Email].filter(Boolean).join(" · ") || "—"}</p>
        </div>
      ),
    },
    {
      id: "wants",
      accessorFn: (l) => `${l.BhkPreference ?? ""} ${l.PropertyType ?? ""} ${l.PreferredLocation ?? ""}`,
      header: "Looking for",
      size: 220,
      cell: ({ row: { original: l } }) => (
        <div className="leading-tight text-xs">
          <p className="text-foreground">{[l.BhkPreference, l.PropertyType].filter(Boolean).join(" ") || "—"}</p>
          <p className="text-muted-foreground">{[l.PreferredLocation, budget(l)].filter(Boolean).join(" · ")}</p>
        </div>
      ),
    },
    {
      id: "source",
      accessorFn: (l) => `${l.SourceType ?? ""} ${l.SalespersonName ?? ""}`,
      header: "Source / salesperson",
      size: 170,
      cell: ({ row: { original: l } }) => (
        <div className="leading-tight text-xs">
          <p className="text-foreground">{l.SourceType || "—"}</p>
          <p className="text-muted-foreground">{l.SalespersonName || ""}</p>
        </div>
      ),
    },
    {
      id: "action",
      header: "",
      size: 170,
      enableSorting: false,
      cell: ({ row: { original: l } }) =>
        l.CustomerId ? (
          <div className="flex items-center justify-end gap-3">
            <SheetMark text={l.CustomerNo || "Customer"} tone="done" />
            {customerRights.canView && (
              <button onClick={() => navigate(`/crm/customers?customerId=${l.CustomerId}`)} title="Open the customer" className="p-1.5 text-muted-foreground hover:text-foreground">
                <ExternalLink size={13} />
              </button>
            )}
          </div>
        ) : customerRights.canCreate ? (
          <div className="flex justify-end">
            <button onClick={() => navigate(`/crm/customers?leadId=${l.Id}`)} className={`${KEY_INK} h-8 px-3 whitespace-nowrap`}>
              <UserPlus size={12} /> Create customer
            </button>
          </div>
        ) : (
          <p className="text-right text-[0.6875rem] text-muted-foreground">Needs the Customers right</p>
        ),
    },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Leads"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM"
        title="Leads"
        subtitle="Leads marked Converted in Sales Automation, waiting to be made CRM customers. A customer's application comes later, on Applications."
        action={
          <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh">
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </button>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {stats.map((x) => (
                <div key={x.label}>
                  <p className="label">{x.label}</p>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 flex flex-wrap items-center gap-3" style={{ borderBottom: RULE }}>
              <span className="inline-flex h-9 border border-foreground" role="group" aria-label="Show">
                {([
                  ["waiting", `Waiting (${waiting.length})`],
                  ["made", `Made customers (${made.length})`],
                ] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setShow(k)} aria-pressed={show === k}
                    className={`font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] px-3 transition-colors ${show === k ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"}`}>
                    {label}
                  </button>
                ))}
              </span>
              {!rights.canView && <p className="text-xs text-destructive">You don't have the right to see this page.</p>}
            </div>

            {isError ? (
              <p className="px-5 py-10 text-center text-sm text-destructive">{(error as Error)?.message}</p>
            ) : (
              <DataTable
                data={rows}
                columns={columns}
                loading={isLoading}
                searchable
                searchPlaceholder="Search name, mobile, lead code, location…"
                paginated
                getRowId={(l) => String(l.Id)}
                emptyMessage={
                  show === "waiting"
                    ? "No converted leads waiting. A lead lands here when it is marked Converted in Sales Automation."
                    : "No lead has been made a customer yet."
                }
              />
            )}
          </div>
        </div>
      </SheetShell>
    </>
  );
}
