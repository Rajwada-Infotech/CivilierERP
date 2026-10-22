// Picking the HSN / SAC code and GST rate for a line.
import React, { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { X, Receipt, Search, List } from "lucide-react";
import { WOGSTType, Activity } from "./config";

// ─── HSN Popover ──────────────────────────────────────────────────────────────
// Uses Radix Popover (built-in portal) — no manual position math needed.

export const HsnPopover: React.FC<{
  activity: Activity;
  hsnRecords: {
    code: string;
    shortDesc: string;
    igstRate: number;
    cgstRate: number;
    sgstRate: number;
  }[];
  onUpdate: (patch: Partial<Activity>) => void;
  /** compact = small trigger pill for desktop table cell; full-width for mobile */
  variant?: "compact" | "full";
}> = ({ activity, hsnRecords, onUpdate, variant = "compact" }) => {
  const [hsnOpen, setHsnOpen] = useState(false);
  const [hsnSearch, setHsnSearch] = useState("");

  const filteredHsn = hsnRecords.filter(
    (h) =>
      h.code.toLowerCase().includes(hsnSearch.toLowerCase()) ||
      h.shortDesc.toLowerCase().includes(hsnSearch.toLowerCase()),
  );

  const hasHsn = Boolean(activity.hsnCode);

  const triggerClass =
    variant === "full"
      ? `w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors ${
          hasHsn
            ? "border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300"
            : "border-border bg-background text-muted-foreground hover:border-violet-300 hover:text-foreground"
        }`
      : `w-full flex items-center gap-1 px-2 py-1.5 rounded-md border text-xs font-medium transition-colors ${
          hasHsn
            ? "border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300"
            : "border-border bg-background text-muted-foreground hover:border-violet-300 hover:text-foreground"
        }`;

  return (
    <Popover
      open={hsnOpen}
      onOpenChange={(open) => {
        setHsnOpen(open);
        if (!open) setHsnSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className={triggerClass}>
          <Receipt size={variant === "full" ? 12 : 11} className="shrink-0" />
          <span className="truncate text-[0.6875rem]">
            {variant === "full"
              ? hasHsn
                ? `SAC: ${activity.hsnCode} (${activity.hsnGstRate}%)`
                : "Add SAC / GST"
              : activity.hsnCode || "SAC"}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-72 p-0 overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="px-3 py-2 border-b border-foreground/30 flex items-center justify-between">
          <p className="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wider">
            Select SAC Code
          </p>
          <button
            type="button"
            onClick={() => setHsnOpen(false)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={13} />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-foreground/30">
          <input
            autoFocus
            value={hsnSearch}
            onChange={(e) => setHsnSearch(e.target.value)}
            placeholder="Search code or description…"
            className="w-full text-xs border border-foreground/30 px-2.5 py-1.5 bg-card text-foreground focus:outline-none"
          />
        </div>

        {/* List */}
        <div className="max-h-56 overflow-y-auto divide-y divide-foreground/10">
          {hasHsn && (
            <button
              type="button"
              onClick={() => {
                onUpdate({
                  hsnCode: "",
                  hsnGstRate: 0,
                  hsnGstType: "cgst_sgst",
                });
                setHsnOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-xs text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/10 transition"
            >
              ✕ Remove SAC
            </button>
          )}
          {filteredHsn.length === 0 ? (
            <p className="px-3 py-6 text-xs text-center text-muted-foreground">
              No SAC records found
            </p>
          ) : (
            filteredHsn.map((h) => {
              const gstRate = h.cgstRate + h.sgstRate || h.igstRate;
              const gstType: WOGSTType =
                h.cgstRate > 0 || h.sgstRate > 0 ? "cgst_sgst" : "igst";
              return (
                <button
                  key={h.code}
                  type="button"
                  onClick={() => {
                    onUpdate({
                      hsnCode: h.code,
                      hsnGstRate: gstRate,
                      hsnGstType: gstType,
                    });
                    setHsnOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-primary/5 transition text-xs ${
                    activity.hsnCode === h.code
                      ? "bg-card"
                      : ""
                  }`}
                >
                  <span>
                    <span className="font-heading font-semibold text-foreground">
                      {h.code}
                    </span>
                    <span className="text-muted-foreground ml-1.5">
                      {h.shortDesc}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold text-foreground">
                    {gstRate}%
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
