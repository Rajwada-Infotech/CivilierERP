import { useNavigate } from "react-router-dom";
import { SheetShell } from "@/components/sheet/Sheet";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { QueryReportTable } from "@/pages/Reports";

/**
 * Civil Work DPR > Query — the same "User-Wise Daily Work Report" that lives under Reports (one report
 * definition, shown from two places). Clicking a row opens that activity straight in Reporting.
 */
export default function Query() {
  usePageRights("civilworkdpr-query");
  const navigate = useNavigate();
  return (
    <>
      <Breadcrumbs items={[{ label: "Civil Work DPR", path: "/civilworkdpr" }, { label: "Query" }]} />
      <SheetShell
        eyebrow="CivilierERP · Civil Work DPR"
        title="Daily work report"
        subtitle="What each person reported on each day, across the last thirty days. Press a row to open that activity in Reporting."
      >
      <QueryReportTable
        reportId="cwd-user-daily-work"
        onRowOpen={(row) => {
          const rung = Number(row.rungId);
          if (!Number.isInteger(rung) || rung <= 0) return;
          const chain = Number(row.chainId);
          navigate(`/civilworkdpr/activity-reporting?rung=${rung}${Number.isInteger(chain) && chain > 0 ? `&chain=${chain}` : ""}`, {
            state: { returnTo: "/civilworkdpr/query" },
          });
        }}
        onClose={() => navigate("/civilworkdpr")}
      />
      </SheetShell>
    </>
  );
}
