import { useNavigate } from "react-router-dom";
import { usePaged } from "@/components/legal/usePaged";
import { getDeedProcessLands, getLandPendingPage } from "@/api/legalLandApi";
import { getPendingAmendments } from "@/api/legalAmendmentApi";
import { getReviewQueue } from "@/api/legalFlowApi";

/**
 * Dashboard → "Waiting for me": what needs a decision now (the Approvals inbox, by kind) and what is running late
 * in Deed Process. Each tile opens the right place.
 */
export function WaitingForMe() {
  const navigate = useNavigate();
  // Each tile is the total of a one-row page of that kind (the same queries the Approvals inbox counts with).
  const cVerify = usePaged(["legal-land-pending-queue", "count"], (qs) => getLandPendingPage(qs), { kind: "verify", pageSize: 1 });
  const cRe = usePaged(["legal-deed-process", "count", "reverify"], (qs) => getDeedProcessLands(qs), { kind: "reverify", pageSize: 1 });
  const cAp = usePaged(["legal-deed-process", "count", "approve"], (qs) => getDeedProcessLands(qs), { kind: "approve", pageSize: 1 });
  const cV1 = usePaged(["legal-review-queue", "count", "verify"], (qs) => getReviewQueue(qs), { kind: "verify", pageSize: 1 });
  const cV2 = usePaged(["legal-review-queue", "count", "approve"], (qs) => getReviewQueue(qs), { kind: "approve", pageSize: 1 });
  const cAm = usePaged(["legal-amend", "pending", "count"], (qs) => getPendingAmendments(qs), { pageSize: 1 });
  const cLate = usePaged(["legal-deed-process", "count", "overdue"], (qs) => getDeedProcessLands(qs), { kind: "overdue", pageSize: 1 });
  const can = (b?: boolean) => b !== false;
  const tiles: { label: string; n: number; to: string; mine: boolean; tone?: string }[] = [
    { label: "Land verification", n: cV1.total, to: "/legal/approvals?tab=landverify", mine: cV1.data?.canVerify !== false },
    { label: "Versions · approve", n: cV2.total, to: "/legal/approvals?tab=versions", mine: cV2.data?.canApprove !== false },
    { label: "Deed approval", n: cAp.total, to: "/legal/approvals?tab=approve", mine: can(cAp.data?.canApprove) },
    { label: "Amendments", n: cAm.total, to: "/legal/approvals?tab=amend", mine: !!cAm.data?.canApprove },
    { label: "Deed overdue", n: cLate.total, to: "/legal/land/deed-process", mine: true, tone: "red" },
  ];
  const total = tiles.filter((t) => t.mine).reduce((s, t) => s + t.n, 0);
  return (
    <section className="border-2 border-foreground bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">Waiting for me</h2>
        <span className="text-xs text-muted-foreground">{total ? `${total} item${total === 1 ? "" : "s"} need you` : "Nothing waiting — all clear"}</span>
      </header>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t, i) => (
          <button key={t.label} onClick={() => navigate(t.to)} disabled={!t.mine}
            className={`px-4 py-3 text-left transition-colors hover:bg-primary/5 disabled:cursor-default disabled:opacity-50 ${i ? "border-l border-border" : ""} ${t.n && t.mine ? (t.tone === "red" ? "bg-destructive/5" : "bg-amber-500/5") : ""}`}
            title={t.mine ? `Open ${t.label}` : "Not your approval role"}>
            <span className={`block text-2xl font-heading font-bold tabular-nums ${t.n && t.mine ? (t.tone === "red" ? "text-destructive" : "text-amber-700 dark:text-amber-400") : ""}`}>{t.n}</span>
            <span className="block text-[0.6875rem] font-semibold uppercase tracking-[0.06em]">{t.label}</span>
            {!t.mine && <span className="block text-[0.625rem] text-muted-foreground">not your role</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
