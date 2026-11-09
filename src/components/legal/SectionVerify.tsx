import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { getLandSections, verifyLandSection } from "@/api/legalLandApi";
import { getLandDocuments } from "@/api/legalDocumentsApi";
import { LegalFileLink } from "./LegalDocumentPreview";

// The document section (Documents tab) that belongs to each land-page section.
const DOC_SECTION: Record<string, string> = {
  ownership: "Ownership", transfers: "Purchase / Sale", records: "Property", legal: "Legal", loans: "Loan & Mortgage",
  mutation: "Mutation", payments: "Payment", tax: "Tax", survey: "Survey & Valuation",
};
export const VERIFY_SECTION_TABS = Object.keys(DOC_SECTION);

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

/**
 * End of a land-page section: the verifier reads every row above and the section's documents (listed here),
 * then ticks "Verified" once — every row of the section is marked Verified. Unticking sets them back to pending.
 */
export const SectionVerify: React.FC<{ landId: number; section: string; onSaved?: () => void }> = ({ landId, section, onSaved }) => {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["legal-land-sections", landId], queryFn: () => getLandSections(landId), enabled: landId > 0 });
  const { data: docs } = useQuery({ queryKey: ["legal-land-docs", landId], queryFn: () => getLandDocuments(landId), enabled: landId > 0 });
  const [busy, setBusy] = useState(false);
  const st = data?.[section];
  if (!st) return null;
  const sectionDocs = (docs?.documents ?? []).filter((d) => d.RelatedSection === DOC_SECTION[section]);

  const toggle = async (verified: boolean) => {
    setBusy(true);
    try {
      toast.success((await verifyLandSection(landId, section, verified)).message);
      await qc.invalidateQueries({ queryKey: ["legal-land-sections", landId] });
      qc.invalidateQueries({ queryKey: ["legal-master"] });
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change verification");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`mt-5 border p-4 ${st.done ? "border-emerald-500/50 bg-emerald-500/5" : "border-border bg-card"}`}>
      <p className="text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground">Section verification · {st.label}</p>

      <div className="mt-2">
        <p className="text-xs text-muted-foreground">Documents for this section ({sectionDocs.length})</p>
        {sectionDocs.length ? (
          <ul className="mt-1 flex flex-wrap gap-2">
            {sectionDocs.map((d) => (
              <li key={d.DocumentId} className="inline-flex items-center gap-1.5 border border-border px-2 py-1 text-xs">
                <LegalFileLink id={d.FileId} name={d.Title || d.FileName} />
                <span className="text-muted-foreground">{d.DocTypeName}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">None filed under {DOC_SECTION[section]}. Row documents open from the table above.</p>
        )}
      </div>

      {st.total === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Nothing entered in this section yet.</p>
      ) : (
        <label className={`mt-3 flex items-start gap-2.5 text-sm ${busy ? "opacity-60" : "cursor-pointer"}`}>
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-600" checked={st.done} disabled={busy}
            onChange={(e) => toggle(e.target.checked)} />
          <span>
            <b>Verified</b> — I have checked all {st.total} entr{st.total === 1 ? "y" : "ies"} above and their documents.
            {st.done ? (
              <span className="mt-0.5 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 size={12} /> Verified{st.verifiedBy ? ` by ${st.verifiedBy}` : ""}{st.verifiedAt ? ` · ${fmt(st.verifiedAt)}` : ""}
              </span>
            ) : st.verified > 0 ? (
              <span className="mt-0.5 block text-xs text-amber-600">{st.verified} of {st.total} verified — new or changed entries need checking.</span>
            ) : (
              <span className="mt-0.5 block text-xs text-muted-foreground">Only a verifier (Setup → Approval Control) who did not enter these rows can tick this.</span>
            )}
          </span>
        </label>
      )}
    </div>
  );
};
