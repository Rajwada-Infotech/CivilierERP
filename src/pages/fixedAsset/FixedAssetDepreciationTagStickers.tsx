// FA Code Stickers: barcode stickers for FA Item Codes that have become fixed assets, printed any number of times.
// The sticker itself (print sheet and on-screen preview) is in ./stickers/printStickers.
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer, RefreshCw } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { usePageRights } from "@/hooks/usePageRights";
import { useFinYear } from "@/contexts/FinYearContext";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getTaggedFAItemCodes, type TaggedFAItemCode } from "@/api/fixedAssetTaggingApi";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, ensureArray, fmtDate } from "./record/config";
import { StickerPreview, printStickers } from "./stickers/printStickers";

interface Filters {
  companyId: string;
  finYear: string;
  fromDate: string;
  toDate: string;
  faCode: string;
  itemName: string;
}
const EMPTY: Filters = { companyId: "", finYear: "", fromDate: "", toDate: "", faCode: "", itemName: "" };

export default function FixedAssetDepreciationTagStickers() {
  usePageRights("fixed-asset-tagging");
  const { finYears } = useFinYear();
  // Typed searches wait for Apply (or Enter); the pickers apply at once.
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [printOpen, setPrintOpen] = useState(false);

  const { data: companies = [] } = useQuery({ queryKey: ["enterprise-options-C"], queryFn: () => getEnterpriseOptions(undefined, "C") });
  const { data: rows = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["fa-tagged-codes", applied],
    queryFn: () =>
      getTaggedFAItemCodes({
        companyId: applied.companyId ? Number(applied.companyId) : undefined,
        finYear: applied.finYear || undefined,
        fromDate: applied.fromDate || undefined,
        toDate: applied.toDate || undefined,
        faCode: applied.faCode || undefined,
        itemName: applied.itemName || undefined,
      }),
    placeholderData: (prev) => prev,
  });
  const list = ensureArray<TaggedFAItemCode>(rows);
  const anyFilter = Object.values(applied).some(Boolean);

  const setNow = (patch: Partial<Filters>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setApplied((a) => ({ ...a, ...patch }));
  };
  const apply = () => setApplied(draft);
  const reset = () => { setDraft(EMPTY); setApplied(EMPTY); setSelected(new Set()); };

  // Only what is on screen counts as picked: a code a filter hides is not printed, so it isn't counted either.
  const selectedRows = useMemo(() => list.filter((r) => selected.has(r.TagId)), [list, selected]);
  const allSelected = list.length > 0 && selectedRows.length === list.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(list.map((r) => r.TagId)));
  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const COLUMNS: ColumnDef<TaggedFAItemCode>[] = [
    {
      id: "pick",
      size: 44,
      enableSorting: false,
      header: () => (
        <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Pick every code shown" className="h-4 w-4 accent-foreground align-middle" />
      ),
      cell: ({ row: { original: r } }) => (
        <input type="checkbox" checked={selected.has(r.TagId)} onChange={() => toggleOne(r.TagId)} onClick={(e) => e.stopPropagation()}
          aria-label={`Pick ${r.FAItemCode}`} className="h-4 w-4 accent-foreground align-middle" />
      ),
    },
    { id: "FAItemCode", accessorKey: "FAItemCode", size: 230, header: "FA Item Code", cell: ({ getValue }) => <span className="font-heading tabular-nums text-xs font-semibold text-foreground">{getValue() as string}</span> },
    {
      id: "ItemName",
      size: 240,
      accessorFn: (r) => `${r.ItemName ?? ""} ${r.AssetCode ?? ""}`,
      header: "Asset",
      cell: ({ row: { original: r } }) => (
        <div className="leading-tight max-w-[240px]">
          <p className="text-sm text-foreground truncate">{r.ItemName || "—"}</p>
          <p className="text-[0.6875rem] text-muted-foreground font-heading tabular-nums">{r.AssetCode || "—"}</p>
        </div>
      ),
    },
    {
      id: "ProjectName",
      size: 200,
      accessorFn: (r) => `${r.ProjectName ?? ""} ${r.CompanyName ?? ""}`,
      header: "Company / project",
      cell: ({ row: { original: r } }) => (
        <div className="text-xs leading-tight">
          <p className="text-foreground">{r.ProjectName || "—"}</p>
          <p className="text-muted-foreground">{r.CompanyName || ""}</p>
        </div>
      ),
    },
    { id: "DocDate", accessorKey: "DocDate", size: 110, header: "Tagged", cell: ({ row: { original: r } }) => <span className="text-xs tabular-nums whitespace-nowrap">{fmtDate(r.DocDate)}</span> },
  ];

  const openPrint = () => (selectedRows.length ? setPrintOpen(true) : toast.error("Pick at least one FA Item Code."));
  const field = `${INP} !h-9 text-xs`;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Fixed Asset", "FA Code Stickers"]} />
      <SheetShell
        eyebrow="CivilierERP · Fixed Asset"
        title="FA code stickers"
        subtitle="Barcode stickers for FA Item Codes that are already fixed assets on Fixed Asset Depreciation Tag. Print or reprint them as often as needed."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh">
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            </button>
            <button onClick={openPrint} className={`${KEY_INK} h-9 px-4`}>
              <Printer size={13} /> Print{selectedRows.length ? ` ${selectedRows.length}` : ""} sticker{selectedRows.length === 1 ? "" : "s"}
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow" style={{ padding: "16px 16px 18px" }}>
              {[
                { label: "Codes", value: isLoading ? "…" : String(list.length), note: anyFilter ? "matching the filters" : "with a fixed asset record" },
                { label: "Picked", value: String(selectedRows.length), note: selectedRows.length ? "ready to print" : "tick the codes to print" },
                { label: "Sheet", value: `${Math.ceil(selectedRows.length / 16)} page${Math.ceil(selectedRows.length / 16) === 1 ? "" : "s"}`, note: "16 stickers to an A4 page, 2 across" },
              ].map((x) => (
                <div key={x.label}>
                  <p className="label">{x.label}</p>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end" style={{ borderBottom: RULE }}>
              <label className="space-y-1.5 lg:col-span-2">
                <span className={`block ${LBL}`}>FA Item Code</span>
                <input value={draft.faCode} onChange={(e) => setDraft((p) => ({ ...p, faCode: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && apply()} placeholder="Part of a code" className={field} />
              </label>
              <label className="space-y-1.5 lg:col-span-2">
                <span className={`block ${LBL}`}>Item name</span>
                <input value={draft.itemName} onChange={(e) => setDraft((p) => ({ ...p, itemName: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && apply()} placeholder="Part of a name" className={field} />
              </label>
              <label className="space-y-1.5">
                <span className={`block ${LBL}`}>Company</span>
                <select value={draft.companyId} onChange={(e) => setNow({ companyId: e.target.value })} className={field}>
                  <option value="">All companies</option>
                  {ensureArray<{ id: number; label: string }>(companies).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className={`block ${LBL}`}>Financial year</span>
                <select value={draft.finYear} onChange={(e) => setNow({ finYear: e.target.value })} className={field}>
                  <option value="">All years</option>
                  {finYears.map((f) => <option key={f.id} value={f.year}>{f.year}</option>)}
                </select>
              </label>
              <label className="space-y-1.5 lg:col-span-2">
                <span className={`block ${LBL}`}>Tagged from</span>
                <DateInput value={draft.fromDate} onChange={(e) => setNow({ fromDate: e.target.value })} className={field} />
              </label>
              <label className="space-y-1.5 lg:col-span-2">
                <span className={`block ${LBL}`}>Tagged to</span>
                <DateInput value={draft.toDate} onChange={(e) => setNow({ toDate: e.target.value })} className={field} />
              </label>
              <div className="flex gap-2 lg:col-span-2 lg:justify-end">
                <button onClick={reset} className={`${KEY_LINE} h-9 px-3`}>Reset</button>
                <button onClick={apply} className={`${KEY_INK} h-9 px-4`}>Apply</button>
              </div>
            </div>
            <DataTable
              data={list}
              columns={COLUMNS}
              loading={isLoading}
              searchable={false}
              paginated
              onRowClick={(row) => toggleOne(row.original.TagId)}
              rowClassName={(row) => (selected.has(row.original.TagId) ? "bg-primary/[0.06]" : "")}
              getRowId={(r) => String(r.TagId)}
              emptyMessage={anyFilter ? "No codes match these filters." : "No FA Item Code is a fixed asset yet. Make one on Fixed Asset Depreciation Tag, then print its sticker here."}
            />
          </div>
        </div>
      </SheetShell>

      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent className="max-w-2xl rounded-none" style={{ border: RULE }}>
          <DialogHeader>
            <DialogTitle className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">
              Print preview · {selectedRows.length} sticker{selectedRows.length === 1 ? "" : "s"}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto flex flex-wrap gap-3 p-1">
            {selectedRows.map((r) => <StickerPreview key={r.TagId} row={r} />)}
          </div>
          <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
            <button onClick={() => setPrintOpen(false)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={() => { printStickers(selectedRows); setPrintOpen(false); }} className={`${KEY_INK} h-9 px-4`}>
              <Printer size={13} /> Print {selectedRows.length}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
