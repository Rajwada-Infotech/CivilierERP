import { MasterList } from "@/components/MasterList";
import { getDepartments } from "@/api/followupApi";

export default function DepartmentMasterScreen() {
  return <MasterList queryKey="department-master" queryFn={getDepartments} emptyLabel="No departments" />;
}
