// Completed tasks — GET /api/task-master/closed-board. Read-only list for
// now; the close-out action (with a completion note) is web-only until the
// task detail screen is ported.
import { TaskList } from "@/components/TaskList";
import { getClosedBoard } from "@/api/followupApi";

export default function CloseTaskScreen() {
  return <TaskList queryKey="closed-board" queryFn={getClosedBoard} emptyLabel="No completed tasks" />;
}
