import { FinanceShell } from "@/components/finance/FinanceShell";
import { AmendmentLogPage } from "@/components/amendment/AmendmentLogPage";

export default function FinanceAmendment() {
  return <AmendmentLogPage module="finance" title="Amendment" Shell={FinanceShell} />;
}
