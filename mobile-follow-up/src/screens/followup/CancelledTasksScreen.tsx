// Cancelled tasks — GET /api/task-master/cancelled-board.
import { TaskList } from "@/components/TaskList";
import { getCancelledBoard } from "@/api/followupApi";

export default function CancelledTasksScreen() {
  return <TaskList queryKey="cancelled-board" queryFn={getCancelledBoard} emptyLabel="No cancelled tasks" />;
}
