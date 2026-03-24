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
import { Shield, Lock } from "lucide-react";

export default function AdminDashboard() {
  const stats = [
    { title: "Total Users", value: 23, change: "+12%", icon: Users, color: "text-blue-500" },
    { title: "Active Users", value: 18, change: "+5%", icon: UserCheck, color: "text-green-500" },
    { title: "Pending Approvals", value: 7, change: "-2%", icon: ShieldCheck, color: "text-orange-500" },
    { title: "Recent Actions", value: 45, change: "+23%", icon: BarChart3, color: "text-purple-500" },
  ];

  const recentUsers = [
    { name: "Rajesh K.", status: "Active" },
    { name: "Meena P.", status: "Active" },
    { name: "Admin User", status: "Inactive" }
  ];


  const getRelativeTime = (timestamp: number) => {
    const now = Date.now();
    const diffMinutes = Math.floor((now - timestamp) / 1000 / 60);
    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const hours = Math.floor(diffMinutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };


  const getRelativeTimeColor = (timestamp: number) => {
    const diffMinutes = Math.floor((Date.now() - timestamp) / 1000 / 60);
    if (diffMinutes < 60) return 'text-emerald-500';
    if (diffMinutes < 240) return 'text-amber-500';
    return 'text-muted-foreground';
  };



  const recentActivities = [
    { icon: UserCheck, desc: "Rajesh K. granted full Menu Rights access", time: Date.now() - 2*60*1000, user: "Admin" },
    { icon: Shield, desc: "New Purchase Order approval workflow created with 3 levels", time: Date.now() - 15*60*1000, user: "Meena P." },
    { icon: Lock, desc: "Financial Year 2024-25 locked for editing", time: Date.now() - 45*60*1000, user: "Admin" },
    { icon: UserCheck, desc: "Widgets Rights updated for Dashboard and Reports", time: Date.now() - 2*60*60*1000, user: "Rajesh K." },
    { icon: Shield, desc: "Post-Approval rights assigned for Invoices module", time: Date.now() - 3*60*60*1000, user: "Admin" },
    { icon: BarChart3, desc: "New FinYear rights configured for reporting", time: Date.now() - 5*60*60*1000, user: "Fin Mgr" }
  ];

  return (
    <AppLayout>
      <Breadcrumbs items={["Admin", "Dashboard"]} />
      
<div className="grid gap-6 mb-8 md:grid-cols-2 lg:grid-cols-4 bg-gradient-to-r from-primary/5 to-secondary/5 rounded-xl p-4">
        {stats.map((stat, index) => (
<Card className="hover:shadow-xl transition-all border-primary/20" key={index}>
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
            <ul className="space-y-2 divide-y divide-border/50">
              {recentUsers.map((user) => (
                <li key={user.name} className="flex items-center justify-between text-sm">
                  <span>{user.name}</span>
                  <div className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground border-2 ${user.status === "Active" ? "border-green-500" : "border-red-500"}`}>
                    {user.status}
                  </div>
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
              {recentActivities.map((activity, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-gradient-to-r from-muted/50 to-accent/20 rounded-xl text-sm hover:shadow-md hover:ring-2 hover:ring-primary/30 transition-all group">
                  <activity.icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="min-w-0 flex-1">

                    <p className="font-semibold text-foreground line-clamp-1 bg-gradient-to-r from-primary to-accent bg-clip-text">{activity.desc}</p>

                    <p className="text-xs text-muted-foreground">
                      by {activity.user} • {new Date(activity.time).toLocaleString('en-IN', { 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric', 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </p>
                  </div>
                  <Badge variant="outline" className={`text-xs whitespace-nowrap ${getRelativeTimeColor(activity.time)}`}>
                    {getRelativeTime(activity.time)}
                  </Badge>


                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

