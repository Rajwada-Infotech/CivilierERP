import { StatusBadge } from "@/components/StatusBadge";
import { X } from "lucide-react";
import type { ApprovalReviewState } from "./useApprovalReview";

// The panel's header: what the record is, its status, print / download, close.
export function ReviewHeader({ r }: { r: ApprovalReviewState }) {
  const { item, onClose, cfg, Icon, docActions } = r;
  return (
    <>
      {/* Header — coloured gradient keyed to the module accent */}
      <div className="shrink-0 border-b border-border px-5 sm:px-6 py-4 flex items-center gap-3"
        style={{ background: (() => {
          const c = cfg?.color ?? "";
          const m = c.match(/text-(\w+)-(\d+)/);
          if (!m) return undefined;
          const map: Record<string, Record<string, string>> = {
            blue: { 500: "#3b82f6" }, amber: { 500: "#f59e0b", 600: "#d97706" },
            emerald: { 500: "#10b981", 600: "#059669" }, violet: { 500: "#8b5cf6", 600: "#7c3aed" },
            rose: { 500: "#f43f5e" }, teal: { 500: "#14b8a6", 600: "#0d9488" },
            indigo: { 400: "#818cf8", 500: "#6366f1" }, orange: { 500: "#f97316" },
            cyan: { 500: "#06b6d4" }, fuchsia: { 500: "#d946ef", 600: "#c026d3" },
            sky: { 500: "#0ea5e9" }, purple: { 500: "#a855f7" }, lime: { 600: "#65a30d" },
          };
          const hex = map[m[1]]?.[m[2]];
          return hex ? `linear-gradient(135deg, ${hex}18 0%, ${hex}06 100%)` : undefined;
        })() }}
      >
        <div className={`p-2.5 rounded-xl shrink-0 shadow-sm ${cfg?.color ?? "bg-muted text-muted-foreground"}`}>
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] font-bold text-foreground truncate leading-tight">{item.ModuleLabel}</p>
          <p className="text-[0.75rem] text-muted-foreground font-mono truncate mt-0.5">
            {item.Reference || `#${item.RecordId}`}
          </p>
        </div>
        <StatusBadge status={item.Status} />
        {docActions}
        <button
          onClick={onClose}
          className="ml-2 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
        >
          <X size={17} />
        </button>
      </div>
    </>
  );
}
