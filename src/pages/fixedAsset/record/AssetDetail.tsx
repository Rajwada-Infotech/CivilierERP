// One asset opened: what it is, what it cost, what is left on the books after posted depreciation, and posting.
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, PenSquare } from "lucide-react";
import { SheetMark } from "@/components/sheet/Sheet";
import { getFixedAsset, type FixedAssetDetail } from "@/api/fixedAssetApi";
import { DepreciationPosting } from "./DepreciationPosting";
import { Block, Figures, KEY_INK, KEY_LINE, LBL, RULE, ValueBar, assetTone, bookValue, fmt, fmtCur, fmtDate } from "./config";

const Row: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div className="min-w-0">
    <p className={`${LBL} mb-1`}>{label}</p>
    <p className="text-sm font-medium text-foreground break-words">{value || "—"}</p>
  </div>
);

export function AssetDetail({ assetId, canEdit, onBack, onEdit }: { assetId: number; canEdit: boolean; onBack: () => void; onEdit: () => void }) {
  const { data, isLoading, isError, error } = useQuery<FixedAssetDetail>({
    queryKey: ["fixed-asset", assetId],
    queryFn: () => getFixedAsset(assetId),
  });

  if (isLoading) return <p className="p-10 text-center text-sm text-muted-foreground">Loading…</p>;
  if (isError || !data) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className={`${KEY_LINE} h-9 px-3`}><ArrowLeft size={13} /> Back to register</button>
        <p className="p-10 text-center text-sm text-destructive">{(error as Error)?.message || "This asset is no longer in the register."}</p>
      </div>
    );
  }

  const d = data;
  const transferred = d.AssetStatus === "Transferred";
  const value = bookValue(d);
  const left = d.PurchaseCost > 0 ? (value / d.PurchaseCost) * 100 : 0;
  const pl = d.AssetStatus === "Sold" && d.SellingPrice != null ? d.SellingPrice - value : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={onBack} className={`${KEY_LINE} h-9 px-3`}><ArrowLeft size={13} /> Back to register</button>
        {canEdit && !transferred && (
          <button onClick={onEdit} className={`${KEY_INK} h-9 px-4`}><PenSquare size={13} /> Edit</button>
        )}
      </div>

      <div className="bg-card px-5 py-4 flex flex-wrap items-start justify-between gap-4" style={{ border: RULE }}>
        <div className="flex items-start gap-4 min-w-0">
          {d.PictureBase64 && <img src={d.PictureBase64} alt={d.AssetName} className="h-20 w-20 object-cover shrink-0" style={{ border: RULE }} />}
          <div className="min-w-0">
            <p className={LBL}>{d.AssetCategory}{d.DocNo ? ` · ${d.DocNo}` : ""}</p>
            <p className="font-heading text-xl font-bold text-foreground break-words">{d.AssetName}</p>
            <p className="text-xs text-muted-foreground mt-0.5 font-heading tabular-nums">
              {d.AssetCode || "—"}{d.FAItemCode ? ` · ${d.FAItemCode}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <SheetMark text={d.AssetStatus} tone={assetTone(d.AssetStatus)} />
          <p className={LBL}>Book value</p>
          <p className="font-heading text-2xl font-bold tabular-nums text-foreground">{fmtCur(value)}</p>
        </div>
      </div>

      {transferred && (
        <div className="bg-card px-5 py-3 text-sm" style={{ border: RULE }}>
          <p className="font-semibold text-foreground">Transferred to another company</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            This asset left through an Inter-Company Transfer{d.TransferredAt ? ` on ${fmtDate(d.TransferredAt)}` : ""}. Nothing more is depreciated or
            posted against this FA code; the record is kept as history. It is depreciated under its new FA code in the receiving company.
          </p>
        </div>
      )}

      <Block title="Value" note={`${fmt(left)}% of the cost is still on the books`}>
        <Figures
          items={[
            { label: "Purchase cost", value: fmtCur(d.PurchaseCost) },
            { label: "Depreciation posted", value: fmtCur(d.Depreciated) },
            { label: "Book value", value: fmtCur(value), tone: "blue" },
            { label: "Rate", value: d.DepreciationRate ? `${d.DepreciationRate}% ${d.DepreciationType || ""}`.trim() : "Not set" },
          ]}
        />
        <ValueBar value={value} cost={d.PurchaseCost} />
      </Block>

      <Block title="Asset">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
          <Row label="Company" value={d.CompanyName} />
          <Row label="Project" value={d.ProjectName} />
          <Row label="Godown" value={d.GodownName} />
          <Row label="Financial year" value={d.FinYear} />
          <Row label="Brand" value={d.Brand} />
          <Row label="Model" value={d.Model} />
          <Row label="Serial number" value={d.SerialNumber} />
          <Row label="Quantity" value={fmt(d.Quantity)} />
          <Row label="Purchase date" value={fmtDate(d.PurchaseDate)} />
          <Row label="Activation date" value={d.ActivationDate ? fmtDate(d.ActivationDate) : ""} />
          <Row label="Invoice ref" value={d.PurchaseInvoiceRef} />
          <Row label="Supplier" value={d.SupplierName} />
          <Row label="Location" value={d.Location} />
          <Row label="Department" value={d.Department} />
          <Row label="Custodian" value={d.Custodian} />
          <Row label="Useful life" value={d.UsefulLife ? `${d.UsefulLife} years` : ""} />
          <Row label="Repairs SAC code" value={d.RepairType} />
        </div>
      </Block>

      <DepreciationPosting assetId={d.AssetId} canPost={canEdit && !transferred} />

      {d.AssetStatus === "Sold" && (
        <Block title="Sale">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
            <Row label="Buyer" value={d.BuyerName} />
            <Row label="Sale date" value={fmtDate(d.SaleDate)} />
            <Row label="Selling price" value={fmtCur(d.SellingPrice)} />
            <Row label="Book value" value={fmtCur(value)} />
          </div>
          {d.SaleRemarks && <Row label="Sale remarks" value={d.SaleRemarks} />}
          {pl != null && (
            <p className={`font-heading text-sm font-bold ${pl >= 0 ? "text-foreground" : "text-destructive"}`}>
              {pl >= 0 ? "Profit" : "Loss"} on sale: {fmtCur(Math.abs(pl))}
            </p>
          )}
        </Block>
      )}

      {d.Remarks && (
        <Block title="Remarks">
          <p className="text-sm text-foreground whitespace-pre-wrap">{d.Remarks}</p>
        </Block>
      )}
    </div>
  );
}
