import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
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
    <CivilWorkDprShell title="Query" subtitle="User-Wise Daily Work Report — click a row to open the activity in Reporting" icon={Search}>
      <Breadcrumbs items={[{ label: "Civil Work DPR", path: "/civilworkdpr" }, { label: "Query" }]} />
      <QueryReportTable
        reportId="cwd-user-daily-work"
        onRowOpen={(row) => {
          const rung = Number(row.rungId);
          if (!Number.isInteger(rung) || rung <= 0) return;
          const chain = Number(row.chainId);
          navigate(`/civilworkdpr/activity-reporting?rung=${rung}${Number.isInteger(chain) && chain > 0 ? `&chain=${chain}` : ""}`);
        }}
        onClose={() => navigate("/civilworkdpr")}
      />
    </CivilWorkDprShell>
  );
}
