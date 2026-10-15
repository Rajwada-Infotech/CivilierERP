import { Calendar, Hash } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";
import { inp, FieldLabel } from "./config";
import type { GRNState } from "./useGRN";

// GRN date, document type and number.
export function GRNDates({ m }: { m: GRNState }) {
  const { today, editingId, formData, setFormData, grnNumberPreview, loadingPreview } = m;
  return (
    <>
      {/* ── Section 2: Dates + GRN Number ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <FieldLabel>GRN Date</FieldLabel>
          <div className="relative">
            <Calendar
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <DateInput
              value={formData.grnDate}
              max={today}
              onChange={(e) => {
                const val = e.target.value;
                if (val > today) return; // reject future dates
                setFormData((prev) => ({ ...prev, grnDate: val }));
              }}
              className={`${inp} pl-9`}
            />
          </div>
        </div>

        <div>
          <FieldLabel>Doc Date</FieldLabel>
          <div className="relative">
            <Calendar
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <DateInput
              value={formData.docDate}
              max={today}
              onChange={(e) => {
                const val = e.target.value;
                if (val > today) return; // reject future dates
                setFormData((prev) => ({ ...prev, docDate: val }));
              }}
              className={`${inp} pl-9`}
            />
          </div>
        </div>

        <div>
          <FieldLabel>GRN Number</FieldLabel>
          <div className="flex items-center gap-2 px-3 h-[38px] bg-card border border-dashed border-foreground/30">
            <Hash
              size={13}
              className="text-muted-foreground shrink-0"
            />
            {editingId && formData.grnNo ? (
              <span className="font-heading text-sm text-foreground font-semibold">
                {formData.grnNo}
              </span>
            ) : grnNumberPreview?.nextDocNo ? (
              <span className="font-heading text-sm text-foreground font-semibold">
                {grnNumberPreview.nextDocNo}
              </span>
            ) : loadingPreview ? (
              <span className="text-sm text-muted-foreground/60 animate-pulse">
                Generating…
              </span>
            ) : (
              <span className="text-sm text-muted-foreground/40 italic">
                Auto-generated on save
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
