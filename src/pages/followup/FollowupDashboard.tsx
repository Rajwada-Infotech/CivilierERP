import React from "react";
import { useNavigate } from "react-router-dom";
import { useModule } from "@/contexts/ModuleContext";
import { useTask } from "@/contexts/TaskContext";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardBackground } from "@/components/DashboardBackground";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Calendar,
  CheckCircle,
  Clock,
  AlertCircle,
  Activity,
  BadgeCheck,
  FileText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const FollowupDashboard = () => {
  const navigate = useNavigate();
  const { activeModule } = useModule();
  const { tasks, getOverdueTasks, getDueSoonTasks } = useTask();
  const { currentUser } = useAuth();

  const followupTasks = tasks.filter((task) => task.module === "followup");
  const overdueTasks = getOverdueTasks();
  const dueSoonTasks = getDueSoonTasks();
  const completedTasks = followupTasks.filter(
    (task) => task.status === "closed" || task.status === "reviewed",
  );

  const stats = [
    {
      label: "Overdue Follow-ups",
      value: overdueTasks.length.toString(),
      icon: AlertCircle,
      color: "bg-red-500/10 text-red-600",
    },
    {
      label: "Due Soon",
      value: dueSoonTasks.length.toString(),
      icon: Clock,
      color: "bg-amber-500/10 text-amber-600",
    },
    {
      label: "Completed",
      value: completedTasks.length.toString(),
      icon: BadgeCheck,
      color: "bg-green-500/10 text-green-600",
    },
    {
      label: "Pending Tasks",
      value: followupTasks
        .filter((task) => ["open", "in_progress"].includes(task.status))
        .length.toString(),
      icon: Activity,
      color: "bg-indigo-500/10 text-indigo-600",
    },
  ];


  return (
    <div className="relative p-6 space-y-6">
      <DashboardBackground />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold text-foreground">
            Follow-Up Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Track reminders, tasks, and pending follow-ups across projects
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/tasks")}>
            <Calendar className="w-4 h-4 mr-2" />
            View All Tasks
          </Button>
          <Button onClick={() => navigate("/followup/follow-ups/reminders")}>
            New Reminder
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map(({ label, value, icon: Icon, color }, i) => (
          <Card key={label} className="hover:shadow-lg transition-all">
            <CardHeader className="pb-3">
              <div
                className={`w-12 h-12 rounded-xl ${color} flex items-center justify-center mb-3`}
              >
                <Icon className="w-6 h-6" />
              </div>
              <CardTitle className="text-2xl font-heading font-bold text-foreground">
                {value}
              </CardTitle>
              <p className="text-sm text-muted-foreground">{label}</p>
            </CardHeader>
          </Card>
        ))}
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-0">
          <Button
            variant="outline"
            className="justify-start h-16"
            onClick={() => navigate("/followup/follow-ups/tasks")}
          >
            <CheckCircle className="w-5 h-5 mr-3" />
            Review Pending Tasks
            <Badge className="ml-auto text-xs bg-indigo-500/20 text-indigo-700 border-indigo-500/30">
              {followupTasks.filter((task) => task.status === "in_progress").length}
            </Badge>
          </Button>
          <Button
            variant="outline"
            className="justify-start h-16"
            onClick={() => navigate("/followup/follow-ups/reminders")}
          >
            <Clock className="w-5 h-5 mr-3" />
            Manage Reminders
            <Badge className="ml-auto text-xs bg-amber-500/20 text-amber-700 border-amber-500/30">
              {dueSoonTasks.length}
            </Badge>
          </Button>
          <Button
            variant="outline"
            className="justify-start h-16"
            onClick={() => navigate("/followup/follow-ups/log")}
          >
            <FileText className="w-5 h-5 mr-3" />
            Follow-up Log
          </Button>
        </CardContent>
      </Card>

      {/* Recent Follow-ups Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Follow-ups</CardTitle>
        </CardHeader>
        <CardContent>
          {followupTasks.slice(0, 5).map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-4 p-4 border-b last:border-b-0 hover:bg-muted/50 rounded-lg"
            >
              <div
                className={`w-3 h-3 rounded-full ${
                  task.status === "closed"
                    ? "bg-green-500"
                    : task.status === "in_progress"
                      ? "bg-amber-500"
                      : "bg-gray-500"
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm line-clamp-1">{task.title}</p>
                <p className="text-xs text-muted-foreground line-clamp-1">
                  {task.description}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium">
                  {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "-"}
                </p>
                <Badge
                  variant={task.status === "closed" ? "default" : "secondary"}
                  className="text-xs mt-1"
                >
                  {task.status}
                </Badge>
              </div>
            </div>
          ))}
          {followupTasks.length === 0 && (
            <p className="text-sm text-muted-foreground">No follow-up tasks yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default FollowupDashboard;