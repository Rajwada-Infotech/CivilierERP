// Every task (privileged view) — GET /api/task-master. The module's master
// task list, distinct from the follow-up board (which is due-dated & scoped).
import { TaskList } from "@/components/TaskList";
import { getTasks } from "@/api/followupApi";

export default function TaskMasterScreen() {
  return <TaskList queryKey="task-master-all" queryFn={getTasks} emptyLabel="No tasks" />;
}
