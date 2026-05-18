import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTask } from "@/contexts/TaskContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DashboardBackground } from "@/components/DashboardBackground";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Calendar,
  CheckCircle,
  Clock,
  Activity,
  BadgeCheck,
  FileText,
  Home,
  IndianRupee,
  PhoneCall,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

async function fetchFollowupPage(path: string) {
  const response = await fetchWithAuth(`${path}?page=1&pageSize=100`);
  if (!response.ok) throw new Error("Failed to load followup data");
  return response.json() as Promise<{
    data: Record<string, unknown>[];
    pagination: { total: number };
  }>;
}

const FollowupDashboard = () => {
  const navigate = useNavigate();
  const { tasks, getOverdueTasks, getDueSoonTasks } = useTask();
  const { data: applicantsPage } = useQuery({
    queryKey: ["followup-dashboard", "applicants"],
    queryFn: () => fetchFollowupPage("/api/followup-applicants"),
  });
  const { data: unitSelectionsPage } = useQuery({
    queryKey: ["followup-dashboard", "unit-selections"],
    queryFn: () => fetchFollowupPage("/api/followup-unit-selections"),
  });
  const { data: agreementsPage } = useQuery({
    queryKey: ["followup-dashboard", "agreements"],
    queryFn: () => fetchFollowupPage("/api/followup-agreements"),
  });

  const followupTasks = tasks.filter((task) => task.module === "followup");
  const dueSoonTasks = getDueSoonTasks();
  const agreementValue = (agreementsPage?.data ?? []).reduce(
    (sum, agreement) => sum + (Number(agreement.AgreementValue) || 0),
    0,
  );
  const applicantStatusData = Object.entries(
    (applicantsPage?.data ?? []).reduce<Record<string, number>>((acc, applicant) => {
      const status = String(applicant.Status || "Unassigned");
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {}),
  ).map(([status, count]) => ({ status, count }));

  const stats = [
    {
      label: "Applicants",
      value: String(applicantsPage?.pagination?.total ?? 0),
      icon: UserRound,
      color: "bg-sky-500/10 text-sky-600",
    },
    {
      label: "Unit Selections",
      value: String(unitSelectionsPage?.pagination?.total ?? 0),
      icon: Home,
      color: "bg-emerald-500/10 text-emerald-600",
    },
    {
      label: "Agreements",
      value: String(agreementsPage?.pagination?.total ?? 0),
      icon: BadgeCheck,
      color: "bg-violet-500/10 text-violet-600",
    },
    {
      label: "Visible Agreement Value",
      value: `Rs ${agreementValue.toLocaleString("en-IN")}`,
      icon: IndianRupee,
      color: "bg-amber-500/10 text-amber-600",
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
            Track applicants, unit selection, agreements, reminders, and follow-up tasks
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
            onClick={() => navigate("/followup/sales/applicants")}
          >
            <UserRound className="w-5 h-5 mr-3" />
            Manage Applicants
            <Badge className="ml-auto text-xs bg-sky-500/20 text-sky-700 border-sky-500/30">
              {applicantsPage?.pagination?.total ?? 0}
            </Badge>
          </Button>
          <Button
            variant="outline"
            className="justify-start h-16"
            onClick={() => navigate("/followup/sales/unit-selection")}
          >
            <Home className="w-5 h-5 mr-3" />
            Unit Selection
            <Badge className="ml-auto text-xs bg-emerald-500/20 text-emerald-700 border-emerald-500/30">
              {unitSelectionsPage?.pagination?.total ?? 0}
            </Badge>
          </Button>
          <Button
            variant="outline"
            className="justify-start h-16"
            onClick={() => navigate("/followup/agreement/agreements")}
          >
            <FileText className="w-5 h-5 mr-3" />
            Agreements
            <Badge className="ml-auto text-xs bg-violet-500/20 text-violet-700 border-violet-500/30">
              {agreementsPage?.pagination?.total ?? 0}
            </Badge>
          </Button>
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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Applicant Funnel</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {applicantStatusData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No applicant status data yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={applicantStatusData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="status" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workflow Areas</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3">
            <Button variant="outline" className="justify-start" onClick={() => navigate("/followup/sales/welcome-calls")}>
              <PhoneCall className="w-4 h-4 mr-2" />
              Welcome Calls
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => navigate("/followup/closure/noc")}>
              <FileText className="w-4 h-4 mr-2" />
              NOC
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => navigate("/followup/closure/sales-deed")}>
              <FileText className="w-4 h-4 mr-2" />
              Sales Deed
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => navigate("/followup/closure/handover")}>
              <Home className="w-4 h-4 mr-2" />
              Handover
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => navigate("/followup/construction/updates")}>
              <Activity className="w-4 h-4 mr-2" />
              Construction Updates
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => navigate("/followup/finance/demands")}>
              <IndianRupee className="w-4 h-4 mr-2" />
              Finance Demands
            </Button>
          </CardContent>
        </Card>
      </div>

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
