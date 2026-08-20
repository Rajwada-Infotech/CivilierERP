import { EngineeringShell } from "@/components/engineering/EngineeringShell";
import { AmendmentLogPage } from "@/components/amendment/AmendmentLogPage";

export default function EngineeringAmendment() {
  return <AmendmentLogPage module="engineering" title="Amendment" Shell={EngineeringShell} />;
}
