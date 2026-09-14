import { MasterList } from "@/components/MasterList";
import { getTags } from "@/api/followupApi";

export default function TagMasterScreen() {
  return <MasterList queryKey="tag-master-list" queryFn={getTags} emptyLabel="No tags" />;
}
