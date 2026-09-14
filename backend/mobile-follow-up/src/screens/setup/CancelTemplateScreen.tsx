import { MasterList } from "@/components/MasterList";
import { getCancelTemplates } from "@/api/followupApi";

export default function CancelTemplateScreen() {
  return <MasterList queryKey="cancel-template-master" queryFn={getCancelTemplates} emptyLabel="No cancel reasons" />;
}
