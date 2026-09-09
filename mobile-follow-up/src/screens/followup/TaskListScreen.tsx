// All active/on-hold tasks with a due date (backend scopes to the caller
// unless privileged) — GET /api/task-master/followup-board.
import { TaskList } from "@/components/TaskList";
import { getFollowUpBoard } from "@/api/followupApi";

export default function TaskListScreen() {
  return <TaskList queryKey="followup-board" queryFn={getFollowUpBoard} emptyLabel="No open tasks" />;
}
