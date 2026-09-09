// Follow-Up module landing — same board as TaskList for now (the module's
// dedicated dashboard, charts and follow-up notes get built out later).
import { TaskList } from "@/components/TaskList";
import { getFollowUpBoard } from "@/api/followupApi";

export default function FollowUpDashboardScreen() {
  return <TaskList queryKey="followup-board" queryFn={getFollowUpBoard} emptyLabel="No open tasks" />;
}
