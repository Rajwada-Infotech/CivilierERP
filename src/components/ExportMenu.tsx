/**
 * ExportMenu.tsx
 *
 * A compact toolbar button that opens a dropdown with three export options:
 * PDF, Excel (.xlsx), and CSV. Plugs into any page that has tabular data.
 *
 * Usage:
 *   <ExportMenu
 *     data={banks}
 *     columns={exportColumns}
 *     title="Bank Master"
 *     filename="bank-master"
 *   />
 *
 * exportColumns is an ExportColumn[] — a plain array of { header, accessor }
 * objects that is separate from the TanStack ColumnDef[] used by DataTable.
 * This separation is intentional: PDF/Excel don't need renderers, sort fns, etc.
 */

import React, { useState, useRef, useEffect } from "react";
import {
  FileDown,
  FileSpreadsheet,
  FileText,
  Loader2,
  ChevronDown,
} from "lucide-react";
import {
  exportToCsv,
  exportToXlsx,
  exportToPdf,
  type ExportColumn,
} from "@/lib/export";
import { toast } from "sonner";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ExportMenuProps {
  /** The full dataset to export (not just the current page) */
  data: Record<string, unknown>[];
  /** Column definitions for export — header + accessor */
  columns: ExportColumn[];
  /** Document / sheet title */
  title: string;
  /** Base filename without extension */
  filename?: string;
  /** Optional subtitle shown in PDF header */
  subtitle?: string;
  /** Disable the button (e.g. while data is loading) */
  disabled?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ExportMenu({
  data,
  columns,
  title,
  filename,
  subtitle,
  disabled = false,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<"pdf" | "xlsx" | "csv" | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const base = filename ?? title.toLowerCase().replace(/\s+/g, "-");

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function run(
    format: "pdf" | "xlsx" | "csv",
    fn: () => Promise<void> | void,
  ) {
    setLoading(format);
    setOpen(false);
    try {
      await fn();
      toast.success(`${title} exported as ${format.toUpperCase()}`);
    } catch (err) {
      console.error(err);
      toast.error(`Export failed: ${(err as Error).message}`);
    } finally {
      setLoading(null);
    }
  }

  const options = [
    {
      key: "pdf" as const,
      label: "PDF Document",
      desc: "A4 landscape, paginated",
      icon: FileText,
      color: "text-rose-500",
      action: () =>
        exportToPdf(data, columns, { title, filename: base, subtitle }),
    },
    {
      key: "xlsx" as const,
      label: "Excel Workbook",
      desc: ".xlsx, auto-fitted columns",
      icon: FileSpreadsheet,
      color: "text-emerald-500",
      action: () => exportToXlsx(data, columns, base),
    },
    {
      key: "csv" as const,
      label: "CSV File",
      desc: "Plain text, universal",
      icon: FileDown,
      color: "text-sky-500",
      action: () => exportToCsv(data, columns, base),
    },
  ];

  const isBusy = loading !== null;

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => !disabled && !isBusy && setOpen((o) => !o)}
        disabled={disabled || isBusy}
        className={`
          inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium
          transition-colors select-none
          ${
            disabled || isBusy
              ? "opacity-40 cursor-not-allowed border-border text-muted-foreground bg-muted"
              : "border-border text-foreground bg-card hover:bg-muted cursor-pointer"
          }
        `}
      >
        {isBusy ? (
          <Loader2 size={13} className="animate-spin text-muted-foreground" />
        ) : (
          <FileDown size={13} />
        )}
        Export
        <ChevronDown
          size={11}
          className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="
            absolute right-0 top-full mt-1.5 z-50
            w-56 rounded-xl border border-border bg-card shadow-lg
            overflow-hidden
            animate-in fade-in slide-in-from-top-1 duration-150
          "
        >
          <div className="px-3 py-2 border-b border-border">
            <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
              Export {data.length} record{data.length !== 1 ? "s" : ""}
            </p>
          </div>

          <div className="py-1">
            {options.map((opt) => {
              const Icon = opt.icon;
              const busy = loading === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => run(opt.key, opt.action)}
                  disabled={isBusy}
                  className="
                    w-full flex items-center gap-3 px-3 py-2.5
                    text-left transition-colors
                    hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed
                  "
                >
                  <span
                    className={`flex items-center justify-center w-7 h-7 rounded-lg bg-muted ${opt.color}`}
                  >
                    {busy ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Icon size={14} />
                    )}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-xs font-medium text-foreground leading-tight">
                      {opt.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                      {opt.desc}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default ExportMenu;
