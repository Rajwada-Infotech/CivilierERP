import React from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ShieldCheck, Users, UserCheck, BarChart3 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function AdminDashboard() {
  const stats = [
    { title: "Total Users", value: 23, change: "+12%", icon: Users, color: "text-blue-500" },
    { title: "Active Users", value: 18, change: "+5%", icon: UserCheck, color: "text-green-500" },
    { title: "Pending Approvals", value: 7, change: "-2%", icon: ShieldCheck, color: "text-orange-500" },
    { title: "Recent Actions", value: 45, change: "+23%", icon: BarChart3, color: "text-purple-500" },
  ];

  return (
    <AppLayout>
      <Breadcrumbs items={["Admin", "Dashboard"]} />
      
      <div className="grid gap-6 mb-8 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">
                {stat.change} from last month
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent Users</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {["Rajesh K.", "Meena P.", "Admin User"].map((name, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span>{name}</span>
                  <Badge variant="outline">Active</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                "User permissions updated - Rajesh K.",
                "New approval workflow created",
                "Financial year 2024-25 locked",
              ].map((activity, i) => (
                <div key={i} className="flex items-center p-3 bg-muted/50 rounded-lg text-sm">
                  • {activity}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

