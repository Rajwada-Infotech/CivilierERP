import { EngineeringShell } from "@/components/engineering/EngineeringShell";
import { AmendmentLogPage } from "@/components/amendment/AmendmentLogPage";
import { usePageRights } from "@/hooks/usePageRights";

export default function EngineeringAmendment() {
  usePageRights("engineering-amendment");
  return <AmendmentLogPage module="engineering" title="Amendment" Shell={EngineeringShell} />;
}
