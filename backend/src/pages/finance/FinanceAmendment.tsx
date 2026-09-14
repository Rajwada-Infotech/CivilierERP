import { FinanceShell } from "@/components/finance/FinanceShell";
import { AmendmentLogPage } from "@/components/amendment/AmendmentLogPage";
import { usePageRights } from "@/hooks/usePageRights";

export default function FinanceAmendment() {
  usePageRights("finance-amendment");
  return <AmendmentLogPage module="finance" title="Amendment" Shell={FinanceShell} />;
}
