// The three schedules of a depreciation run: the project's assets for the month, what has been posted, and each Generate click.
import { SheetMark } from "@/components/sheet/Sheet";
import type { ColumnDef } from "@/components/ui/DataTable";
import type { GenerateAssetRow, GenerateOutcome, GenerateRunRow, PostingHistoryRow } from "@/api/fixedAssetDepreciationGenerateApi";
import { assetMark, fmtAmt, fmtDateTime, monthLabel } from "./config";

const Num = ({ v, strong }: { v: number | null | undefined; strong?: boolean }) => (
  <p className={`text-right tabular-nums text-sm ${strong ? "font-heading font-bold text-foreground" : ""}`}>{fmtAmt(v)}</p>
);
const Code = ({ v }: { v: string | null | undefined }) => <p className="font-heading tabular-nums text-xs">{v || "—"}</p>;

export function assetColumns(
  monthName: string,
  outcomeOf: Map<number, GenerateOutcome>,
  failedMsg: Map<number, string>,
): ColumnDef<GenerateAssetRow>[] {
  return [
    {
      id: "Asset",
      accessorFn: (r) => `${r.faItemCode} ${r.assetName ?? ""}`,
      size: 240,
      header: "Asset",
      cell: ({ row: { original: r } }) => (
        <div className="leading-tight max-w-[260px]">
          <p className="text-sm text-foreground truncate">{r.assetName || "—"}</p>
          <p className="text-[0.6875rem] text-muted-foreground font-heading tabular-nums truncate">{r.faItemCode}</p>
        </div>
      ),
    },
    {
      id: "Method",
      accessorFn: (r) => r.method ?? "",
      size: 130,
      header: "Method / rate",
      cell: ({ row: { original: r } }) =>
        r.method ? (
          <span className="inline-flex items-center gap-2 text-xs">
            <span className="font-heading font-semibold uppercase tracking-[0.06em] border border-foreground/40 px-1.5 py-0.5">{r.method}</span>
            <span className="tabular-nums">{r.ratePct ?? 0}%</span>
          </span>
        ) : "—",
    },
    { id: "Cost", accessorFn: (r) => Number(r.purchaseCost ?? 0), size: 130, header: "Cost", cell: ({ row: { original: r } }) => <Num v={r.purchaseCost} /> },
    {
      id: "Amount",
      accessorFn: (r) => (r.state === "notEligible" ? -1 : Number(r.amount ?? 0)),
      size: 150,
      header: `${monthName} depreciation`,
      cell: ({ row: { original: r } }) => (r.state === "notEligible" ? <p className="text-right">—</p> : <Num v={r.amount} strong />),
    },
    {
      id: "BookValue",
      accessorFn: (r) => Number(r.closingBookValue ?? 0),
      size: 140,
      header: "Book value after",
      cell: ({ row: { original: r } }) => (r.state === "notEligible" ? <p className="text-right">—</p> : <Num v={r.closingBookValue} />),
    },
    {
      id: "State",
      accessorFn: (r) => assetMark(r, outcomeOf.get(r.assetId)).text,
      size: 130,
      header: "Status",
      cell: ({ row: { original: r } }) => { const m = assetMark(r, outcomeOf.get(r.assetId)); return <SheetMark text={m.text} tone={m.tone} />; },
    },
    {
      id: "Details",
      accessorFn: (r) => failedMsg.get(r.assetId) ?? r.voucherNo ?? r.reason ?? "",
      size: 260,
      header: "Voucher / details",
      enableSorting: false,
      cell: ({ row: { original: r } }) => {
        const failed = failedMsg.get(r.assetId);
        if (failed) return <p className="text-xs text-destructive max-w-[300px] whitespace-normal">{failed}</p>;
        if (r.state === "posted")
          return (
            <div className="leading-tight">
              <p className="font-heading tabular-nums text-xs text-foreground">{r.voucherNo || "—"}</p>
              <p className="text-[0.625rem] text-muted-foreground">{fmtDateTime(r.postedAt)}</p>
            </div>
          );
        if (r.state === "notEligible") return <p className="text-xs text-muted-foreground max-w-[300px] whitespace-normal">{r.reason || "—"}</p>;
        return <span className="text-xs text-muted-foreground">—</span>;
      },
    },
  ];
}

export const HISTORY_COLUMNS: ColumnDef<PostingHistoryRow>[] = [
  {
    id: "Month",
    accessorFn: (h) => h.PeriodYear * 100 + h.PeriodMonth,
    size: 110,
    header: "Month",
    cell: ({ row: { original: h } }) => <p className="text-sm font-medium whitespace-nowrap">{monthLabel(h.PeriodYear, h.PeriodMonth)}</p>,
  },
  {
    id: "Asset",
    accessorFn: (h) => `${h.FAItemCode ?? ""} ${h.AssetName ?? ""}`,
    size: 220,
    header: "Asset",
    cell: ({ row: { original: h } }) => (
      <div className="leading-tight max-w-[240px]">
        <p className="text-sm text-foreground truncate">{h.AssetName || "—"}</p>
        <p className="text-[0.6875rem] text-muted-foreground font-heading tabular-nums truncate">{h.FAItemCode || "—"}</p>
      </div>
    ),
  },
  { id: "Dep", accessorKey: "DepreciationAmount", size: 130, header: "Depreciation", cell: ({ row: { original: h } }) => <Num v={h.DepreciationAmount} strong /> },
  { id: "Acc", accessorKey: "AccumulatedDepreciation", size: 130, header: "Accumulated", cell: ({ row: { original: h } }) => <Num v={h.AccumulatedDepreciation} /> },
  { id: "Book", accessorKey: "ClosingBookValue", size: 130, header: "Book value", cell: ({ row: { original: h } }) => <Num v={h.ClosingBookValue} /> },
  {
    id: "Posted",
    accessorKey: "PostedAt",
    size: 170,
    header: "Posted",
    cell: ({ row: { original: h } }) => (
      <div className="leading-tight">
        <p className="text-xs tabular-nums whitespace-nowrap">{fmtDateTime(h.PostedAt)}</p>
        {h.PostedBy && <p className="text-[0.625rem] text-muted-foreground truncate max-w-[180px]">{h.PostedBy}</p>}
      </div>
    ),
  },
  { id: "Voucher", accessorKey: "VoucherNo", size: 130, header: "Voucher", cell: ({ row: { original: h } }) => <Code v={h.VoucherNo} /> },
  {
    id: "Status",
    accessorKey: "PostingStatus",
    size: 110,
    header: "Status",
    cell: ({ row: { original: h } }) => <SheetMark text={h.PostingStatus} tone={h.PostingStatus === "Posted" ? "done" : "none"} />,
  },
];

export const RUN_COLUMNS: ColumnDef<GenerateRunRow>[] = [
  { id: "At", accessorKey: "StartedAt", size: 170, header: "Run at", cell: ({ row: { original: r } }) => <p className="text-xs tabular-nums whitespace-nowrap">{fmtDateTime(r.StartedAt)}</p> },
  {
    id: "Month",
    accessorFn: (r) => r.PeriodYear * 100 + r.PeriodMonth,
    size: 110,
    header: "Month",
    cell: ({ row: { original: r } }) => <p className="text-sm font-medium whitespace-nowrap">{monthLabel(r.PeriodYear, r.PeriodMonth)}</p>,
  },
  {
    id: "Generated",
    accessorKey: "Generated",
    size: 110,
    header: "Generated",
    cell: ({ row: { original: r } }) => <p className={`text-right tabular-nums text-sm ${r.Generated ? "font-heading font-bold text-foreground" : "text-muted-foreground"}`}>{r.Generated}</p>,
  },
  { id: "Already", accessorKey: "AlreadyPosted", size: 110, header: "Already posted", cell: ({ row: { original: r } }) => <p className="text-right tabular-nums text-sm">{r.AlreadyPosted}</p> },
  { id: "Skipped", accessorKey: "Skipped", size: 90, header: "Not due", cell: ({ row: { original: r } }) => <p className="text-right tabular-nums text-sm">{r.Skipped}</p> },
  {
    id: "Failed",
    accessorKey: "Failed",
    size: 90,
    header: "Failed",
    cell: ({ row: { original: r } }) => <p className={`text-right tabular-nums text-sm ${r.Failed ? "font-bold text-destructive" : "text-muted-foreground"}`}>{r.Failed || "—"}</p>,
  },
  { id: "Amount", accessorKey: "TotalAmount", size: 140, header: "Amount", cell: ({ row: { original: r } }) => <Num v={r.TotalAmount} strong /> },
  { id: "By", accessorFn: (r) => r.RunBy ?? "", size: 180, header: "By", cell: ({ row: { original: r } }) => <p className="text-xs truncate max-w-[200px]">{r.RunBy || "—"}</p> },
];
