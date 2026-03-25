import React from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ShieldCheck, Users, UserCheck, BarChart3 } from "lucide-react";
import {
  Card,
  CardContent,
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
    <>
      <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 lg:px-8 py-6">
    <Breadcrumbs items={["Admin", "Dashboard"]} />

    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8 bg-gradient-to-r from-primary/5 to-secondary/5 rounded-xl p-3 sm:p-4 md:p-6">
      {stats.map((stat, index) => (
        <Card className="hover:shadow-xl transition-all border-primary/20" key={index}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium line-clamp-2">{stat.title}</CardTitle>
            <stat.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${stat.color}`} />
          </CardHeader>
          <CardContent className="pt-1">
            <div className="text-xl sm:text-2xl md:text-3xl font-bold">{stat.value}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stat.change} from last month
            </p>
          </CardContent>
        </Card>
      ))}
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm sm:text-base">Recent Users</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-48 sm:h-56 md:h-64 lg:h-72 pr-4">
            <ul className="space-y-2 p-4 divide-y divide-border/50">
              {recentUsers.map((user) => (
                <li key={user.name} className="flex items-center justify-between py-2 px-1 text-xs sm:text-sm">
                  <span className="truncate">{user.name}</span>
                  <Badge className={`px-1.5 sm:px-2.5 py-0.5 text-xs font-semibold border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 hover:bg-primary/80 ${user.status === "Active" ? "border-green-500 bg-transparent text-green-700 hover:bg-green-500/10" : "border-red-500 bg-transparent text-red-700 hover:bg-red-500/10"}`}>
                    {user.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="md:col-span-1 lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm sm:text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-64 sm:h-72 md:h-[18rem] lg:h-[20rem] xl:h-[22rem] pr-4">
            <div className="space-y-2 p-3 sm:p-4">
              {recentActivities.map((activity, i) => (
                <div key={i} className="flex items-start gap-2 sm:gap-3 p-2 sm:p-3 bg-gradient-to-r from-muted/30 to-accent/30 rounded-lg text-xs sm:text-sm hover:shadow-md hover:ring-1 hover:ring-primary/20 transition-all group">
                  <activity.icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-semibold text-foreground line-clamp-1 bg-gradient-to-r from-primary/80 to-accent/80 bg-clip-text leading-tight">{activity.desc}</p>
                    <p className="text-xs text-muted-foreground leading-tight">
                      by {activity.user} • {new Date(activity.time).toLocaleString('en-IN', { 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric', 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </p>
                  </div>
                  <Badge variant="outline" className={`text-xs whitespace-nowrap ml-1 sm:ml-2 ${getRelativeTimeColor(activity.time)}`}>
                    {getRelativeTime(activity.time)}
                  </Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  </div>
    </>
  );
}

