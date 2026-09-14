import { BadgePercent, TrendingUp, ToggleLeft, ToggleRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field, PriceBreakdownPanel } from "./FormPrimitives";
import { SectionHeader, RateInput } from "./PickerPrimitives";
import { fmt } from "./helpers";
import type { SelectedDoc, DiscountConfig, PriceBreakdown } from "./types";

export type DirectGstMode = "cgst_sgst" | "igst";

interface AmountGstSectionProps {
  selectedDoc: SelectedDoc | null;
  isGRN: boolean;
  isPOorWO: boolean;
  basicAmount: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  gstEnabled: boolean;
  gstMode: DirectGstMode;
  billingTerms: DiscountConfig[];
  discount: DiscountConfig;
  bd: PriceBreakdown;
  gstBreakdown: {
    totals: {
      totalBase: number;
      totalCGST: number;
      totalSGST: number;
    };
  } | null;
  onChangeBasicAmount: (val: number) => void;
  onChangeCgstRate: (val: number) => void;
  onChangeSgstRate: (val: number) => void;
  onChangeIgstRate: (val: number) => void;
  onToggleGstEnabled: (enabled: boolean) => void;
  onChangeGstMode: (mode: DirectGstMode) => void;
  tdsAmount?: number;
}

export function AmountGstSection({
  selectedDoc,
  isGRN,
  isPOorWO,
  basicAmount,
  cgstRate,
  sgstRate,
  igstRate,
  gstEnabled,
  gstMode,
  billingTerms,
  discount,
  bd,
  gstBreakdown,
  onChangeBasicAmount,
  onChangeCgstRate,
  onChangeSgstRate,
  onChangeIgstRate,
  onToggleGstEnabled,
  onChangeGstMode,
  tdsAmount = 0,
}: AmountGstSectionProps) {
  const isDirect = !isGRN && !isPOorWO;
  // Direct/manual bookings gate IGST on the user's CGST+SGST / IGST toggle.
  // Doc-linked bookings (PO/WO/GRN) have no such toggle — igstRate is
  // already 0 unless the linked document's own items were interstate, so
  // it can be shown as-is instead of being masked by a toggle that only
  // exists for the direct-entry flow.
  const effectiveIgstRate = isGRN ? 0 : isDirect ? (gstMode === "igst" ? igstRate : 0) : igstRate;

  return (
    <div className="space-y-4">
      <SectionHeader label="Amount & GST" />
      {/* Info banner — for PO/WO_PO show auto-filled GST summary */}
      {isPOorWO && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-xs">
          <BadgePercent size={12} className="text-emerald-500 shrink-0" />
          {(selectedDoc!.derivedIgstRate ?? 0) > 0 ? (
            <span className="text-foreground">
              GST auto-filled from linked{" "}
              <span className="font-semibold">
                {selectedDoc!.kind === "PO" ? "Purchase Order" : "Work Done"}
              </span>
              {" — "}
              IGST {selectedDoc!.derivedIgstRate}% (interstate). Basic amount
              is pre-tax (qty × rate).
            </span>
          ) : (selectedDoc!.derivedCgstRate ?? 0) > 0 ||
            (selectedDoc!.derivedSgstRate ?? 0) > 0 ? (
            <span className="text-foreground">
              GST auto-filled from linked{" "}
              <span className="font-semibold">
                {selectedDoc!.kind === "PO" ? "Purchase Order" : "Work Done"}
              </span>
              {" — "}
              CGST {selectedDoc!.derivedCgstRate ?? 0}% + SGST{" "}
              {selectedDoc!.derivedSgstRate ?? 0}% (total{" "}
              {(
                (selectedDoc!.derivedCgstRate ?? 0) +
                (selectedDoc!.derivedSgstRate ?? 0)
              ).toFixed(2)}
              %). Basic amount is pre-tax (qty × rate).
            </span>
          ) : selectedDoc!.gst?.applicable ? (
            <span className="text-foreground">
              GST auto-filled from linked{" "}
              <span className="font-semibold">
                {selectedDoc!.kind === "PO" ? "Purchase Order" : "Work Done"}
              </span>
              {" — "}
              {selectedDoc!.gst!.type === "cgst_sgst"
                ? `CGST ${selectedDoc!.gst!.rate / 2}% + SGST ${selectedDoc!.gst!.rate / 2}% (total ${selectedDoc!.gst!.rate}%)`
                : selectedDoc!.gst!.type === "igst"
                  ? `IGST ${selectedDoc!.gst!.rate}% (mapped to CGST)`
                  : "GST not applicable"}
              . Basic amount is pre-tax (qty × rate).
            </span>
          ) : (
            <span className="text-muted-foreground">
              Linked{" "}
              {selectedDoc!.kind === "PO" ? "Purchase Order" : "Work Done"}{" "}
              has no GST on its items — rates set to 0. Basic amount is
              pre-tax (qty × rate).
            </span>
          )}
        </div>
      )}

      {/* GST enable/disable — only for direct/manual (Other Expenses) bookings */}
      {isDirect && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border bg-muted/20">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <BadgePercent size={12} className="shrink-0" />
            GST on this invoice
          </div>
          <div className="flex items-center gap-2">
            {gstEnabled && (
              <div className="flex rounded-lg border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => onChangeGstMode("cgst_sgst")}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${gstMode === "cgst_sgst" ? "bg-emerald-500 text-white" : "bg-background text-muted-foreground hover:text-foreground"}`}
                >
                  CGST + SGST
                </button>
                <button
                  type="button"
                  onClick={() => onChangeGstMode("igst")}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition-colors border-l border-border ${gstMode === "igst" ? "bg-emerald-500 text-white" : "bg-background text-muted-foreground hover:text-foreground"}`}
                >
                  IGST
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => onToggleGstEnabled(!gstEnabled)}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border transition-all"
              style={
                gstEnabled
                  ? {
                      background: "rgba(16,185,129,0.1)",
                      borderColor: "rgba(16,185,129,0.3)",
                      color: "rgb(16,185,129)",
                    }
                  : {}
              }
            >
              {gstEnabled ? (
                <>
                  <ToggleRight size={15} /> GST On
                </>
              ) : (
                <>
                  <ToggleLeft size={15} className="text-muted-foreground" />
                  <span className="text-muted-foreground">GST Off</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <div
        className={`grid grid-cols-1 gap-4 ${isDirect && gstEnabled ? (gstMode === "igst" ? "sm:grid-cols-2" : "sm:grid-cols-3") : ""}`}
      >
        <Field
          label="Basic Amount (₹)"
          required
          hint={
            isGRN
              ? "Enter the invoice amount being booked against this GRN"
              : isPOorWO
                ? "Auto-filled: pre-tax total (qty × rate) from linked order"
                : selectedDoc?.amount != null
                  ? "Auto-filled from linked order value"
                  : "Enter the basic (pre-tax) amount"
          }
        >
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-semibold">
              ₹
            </span>
            <Input
              type="number"
              min={0}
              value={basicAmount || ""}
              readOnly={isPOorWO || (!isGRN && !!selectedDoc?.amount)}
              onChange={(e) => {
                if (isPOorWO || (!isGRN && selectedDoc?.amount)) return;
                onChangeBasicAmount(parseFloat(e.target.value) || 0);
              }}
              className={`pl-7 font-mono ${isPOorWO || (!isGRN && selectedDoc?.amount != null) ? "bg-muted/30 cursor-not-allowed" : ""}`}
              placeholder="0.00"
            />
          </div>
        </Field>
        {/* GST rate inputs — only shown for Other Expenses (no linked doc) when GST is enabled */}
        {isDirect && gstEnabled && gstMode === "cgst_sgst" && (
          <>
            <Field label="CGST Rate (%)" hint="Enter CGST rate manually">
              <RateInput
                value={cgstRate}
                onChange={onChangeCgstRate}
                highlighted={false}
              />
            </Field>
            <Field label="SGST Rate (%)" hint="Enter SGST rate manually">
              <RateInput
                value={sgstRate}
                onChange={onChangeSgstRate}
                highlighted={false}
              />
            </Field>
          </>
        )}
        {isDirect && gstEnabled && gstMode === "igst" && (
          <Field label="IGST Rate (%)" hint="Enter IGST rate manually">
            <RateInput
              value={igstRate}
              onChange={onChangeIgstRate}
              highlighted={false}
            />
          </Field>
        )}
      </div>
      {basicAmount > 0 && (
        <>
          <PriceBreakdownPanel
            bd={bd}
            tdsAmount={tdsAmount}
            cgstRate={
              isGRN
                ? gstBreakdown?.totals.totalBase
                  ? Math.round(
                      (gstBreakdown.totals.totalCGST /
                        gstBreakdown.totals.totalBase) *
                        100 *
                        100,
                    ) / 100
                  : 0
                : cgstRate
            }
            sgstRate={
              isGRN
                ? gstBreakdown?.totals.totalBase
                  ? Math.round(
                      (gstBreakdown.totals.totalSGST /
                        gstBreakdown.totals.totalBase) *
                        100 *
                        100,
                    ) / 100
                  : 0
                : sgstRate
            }
            igstRate={effectiveIgstRate}
            hasDiscount={
              billingTerms && billingTerms.length > 0
                ? billingTerms.some((d) => d.applicable)
                : discount.applicable
            }
          />
          <div className="rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20 px-5 py-4 space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp size={15} className="text-emerald-500" />
                <span className="text-sm font-heading font-semibold text-foreground">
                  Net Payable Amount
                </span>
              </div>
              <span className="font-mono text-xl font-bold text-emerald-600 dark:text-emerald-400">
                ₹{fmt(Math.max(0, bd.netAmount - tdsAmount))}
              </span>
            </div>
            {tdsAmount > 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground pl-5">
                <span>Gross ₹{fmt(bd.netAmount)} — TDS withheld ₹{fmt(tdsAmount)}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
