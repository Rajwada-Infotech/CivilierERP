import { BadgePercent, ToggleLeft, ToggleRight } from "lucide-react";
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
        <div className="flex items-center gap-2 px-3 py-2 border border-foreground/40 text-xs">
          <BadgePercent size={12} className="text-foreground shrink-0" />
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
                  className={`px-2.5 py-1 text-[0.6875rem] font-semibold transition-colors ${gstMode === "cgst_sgst" ? "bg-foreground text-card" : "bg-background text-muted-foreground hover:text-foreground"}`}
                >
                  CGST + SGST
                </button>
                <button
                  type="button"
                  onClick={() => onChangeGstMode("igst")}
                  className={`px-2.5 py-1 text-[0.6875rem] font-semibold transition-colors border-l border-border ${gstMode === "igst" ? "bg-foreground text-card" : "bg-background text-muted-foreground hover:text-foreground"}`}
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
              className={`pl-7 font-heading tabular-nums ${isPOorWO || (!isGRN && selectedDoc?.amount != null) ? "bg-muted/30 cursor-not-allowed" : ""}`}
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
          {/* The one inked block on the form: what is actually payable */}
          <div className="bg-foreground text-card px-5 py-4">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <span className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] opacity-80">Net payable</span>
              <span className="font-heading tabular-nums text-2xl sm:text-3xl font-semibold leading-none tracking-tight">
                ₹{fmt(Math.max(0, bd.netAmount - tdsAmount))}
              </span>
            </div>
            {tdsAmount > 0 && (
              <p className="text-xs mt-2 opacity-75 text-right">
                Gross ₹{fmt(bd.netAmount)} less TDS withheld ₹{fmt(tdsAmount)}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
