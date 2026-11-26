import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getVerificationByLand } from "@/api/legalVerificationApi";

/** The legal verification behind a land (through its enquiry): result, last review and open issues — for approvers. */
export function LandVerificationCard({ landId }: { landId: number }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["legal-verification-by-land", landId], queryFn: () => getVerificationByLand(landId), retry: false });
  const v = q.data;
  if (!v) return null;
  const tone = v.Status === "Verified" ? "border-emerald-700" : "border-amber-600";
  return (
    <section className={`mb-4 border-l-4 ${tone} border border-border bg-card px-3 py-2 text-xs`}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm">Legal verification {v.VerificationNo}</b>
        <span className={v.Status === "Verified" ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>{v.Status === "Verified" ? "Final Legal Review approved" : v.Status === "Ready for Review" ? "Final Legal Review pending" : v.Status}</span>
        <span className="text-muted-foreground">{v.Completed + v.NotApplicable}/{v.Total} verified or N/A · {v.Discrepancies} discrepancies · {v.Overdue} overdue</span>
        <button className="ml-auto underline" onClick={() => navigate(`/legal/land/verification/${v.VerificationId}`)}>Open workspace</button>
      </div>
      {v.lastReview && <p className="mt-1">Last review: version {v.lastReview.VersionNo} · <b>{v.lastReview.Decision}</b> · {v.lastReview.ReviewedBy ?? "—"} · {new Date(v.lastReview.ReviewedAt).toLocaleDateString("en-IN")}{v.lastReview.Remarks ? ` — ${v.lastReview.Remarks}` : ""}</p>}
      {v.Status !== "Verified" && <p className="mt-1 font-semibold text-amber-700">Final Legal Review not approved — Land Approval needs it, or an authorised exception.</p>}
      {v.issues.length > 0 && <p className="mt-1 text-muted-foreground">Open / flagged: {v.issues.slice(0, 8).map((i) => `${i.ActivityNo}. ${i.ActivityName} (${i.Finding ?? i.VerifyStatus ?? i.Status})`).join(", ")}{v.issues.length > 8 ? ` +${v.issues.length - 8} more` : ""}</p>}
    </section>
  );
}
