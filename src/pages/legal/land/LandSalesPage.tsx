import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MoneySend } from "iconsax-react";
import { ArrowLeft } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { getLegalRows } from "@/api/legalMastersApi";
import { LegalMasterTable } from "../LegalMasterPage";

const SALE = { pageKey: "legal-land-master", key: "land-sale", label: "Sales" };
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const small = "rounded-md border border-border px-2 py-1 text-xs hover:bg-muted";

// Selling land the company owns, mapped to its Land ID. /legal/land/sales lists every sale; /legal/land/properties/:id/sales is one land's.
// A sale's money comes in as payments on its land; a land sold in full (registered / completed) is marked Disposed / Transferred.
export default function LandSalesPage() {
  const params = useParams();
  const landId = params.id ? Number(params.id) : undefined;
  const navigate = useNavigate();
  const { data: rows } = useQuery({ queryKey: ["legal-master", SALE.key, landId ?? null], queryFn: () => getLegalRows(SALE.key, landId) });
  const live = (rows ?? []).filter((r) => r.IsActive !== false && r.TxnStatus !== "Cancelled");
  const sum = (k: string) => live.reduce((n, r) => n + Number(r[k] ?? 0), 0);
  const tiles: [string, string][] = [
    ["Sales", String(live.length)],
    ["Sale value", inr(sum("TotalValue"))],
    ["Received (verified)", inr(sum("Received"))],
    ["Balance due", inr(sum("BalanceDue"))],
    ["Completed / registered", String(live.filter((r) => r.TxnStatus === "Completed" || r.TxnStatus === "Registered").length)],
  ];
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", landId ? "Land Register" : "Land Sales", ...(landId ? ["Sales"] : [])]} />
      <LegalShell
        title={landId ? "Sales of this land" : "Land Sales"}
        subtitle="Selling land the company owns, in full or in part. Record the sale here, then its payments on the land's Payment History; a land sold in full is marked Disposed / Transferred."
        icon={MoneySend}
        action={landId ? <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted" onClick={() => navigate(`/legal/land/properties/${landId}`)}><ArrowLeft size={13} /> Land Profile</button> : undefined}
      >
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map(([l, v]) => (
            <div key={l} className="border border-border bg-card p-3">
              <div className="text-lg font-heading font-bold tabular-nums text-foreground">{v}</div>
              <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">{l}</div>
            </div>
          ))}
        </div>
        <ol className="mb-4 grid gap-2 border border-border px-3 py-2 text-xs text-muted-foreground sm:grid-cols-3">
          <li><b className="text-foreground">1 · Record the sale</b> — land, buyer, area, value, status (only land the company owns, never more than its unsold area).</li>
          <li><b className="text-foreground">2 · Take payments</b> — add each receipt on the land's <b>Payment History</b>, linked to this sale; verified payments reduce the balance.</li>
          <li><b className="text-foreground">3 · Register / complete</b> — set the status; once the whole land is sold it becomes <b>Disposed / Transferred</b>.</li>
        </ol>
        <div className="space-y-4">
          <LegalMasterTable
            entry={SALE}
            parentId={landId}
            rowActions={(raw) => (
              <span className="inline-flex gap-1.5">
                {!landId && <button className={small} onClick={() => navigate(`/legal/land/properties/${raw.LandId}`)}>Land</button>}
                <button className={small} onClick={() => navigate(`/legal/land/properties/${raw.LandId}?tab=payments`)}>Payments</button>
              </span>
            )}
          />
        </div>
      </LegalShell>
    </>
  );
}
