import { MaterialShell } from "@/components/material/MaterialShell";
import { AmendmentLogPage } from "@/components/amendment/AmendmentLogPage";
import { usePageRights } from "@/hooks/usePageRights";

export default function MaterialAmendment() {
  usePageRights("material-amendment");
  return <AmendmentLogPage module="material" title="Amendment" Shell={MaterialShell} />;
}
