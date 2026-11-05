import { inp, FieldLabel } from "./config";
import type { GRNState } from "./useGRN";

// Remarks.
export function GRNRemarks({ m }: { m: GRNState }) {
  const { formData, setFormData } = m;
  return (
    <>
      {/* ── Remarks ── */}
      <div>
        <FieldLabel>Remarks</FieldLabel>
        <textarea
          value={formData.remarks}
          onChange={(e) =>
            setFormData((p) => ({ ...p, remarks: e.target.value }))
          }
          rows={3}
          className={`${inp} resize-y`}
          placeholder="Additional notes…"
        />
      </div>
    </>
  );
}
