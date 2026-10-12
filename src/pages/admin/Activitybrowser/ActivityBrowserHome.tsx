import React, { lazy, Suspense, useState } from "react";
import { Activity } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import ActivityByUser from "./ActivityByUser";

// The original session/log browser stays available as a second view.
const SessionsAndLog = lazy(() => import("./ActivityBrowser"));

export default function ActivityBrowserHome() {
  const [view, setView] = useState<"user" | "log">("user");

  const switcher = (
    <div className="inline-flex rounded-lg border border-border p-0.5 bg-background">
      {([["user", "By User"], ["log", "Sessions & Log"]] as const).map(([key, label]) => (
        <button
          key={key}
          onClick={() => setView(key)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${view === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (view === "log") {
    return (
      <>
        <div className="mb-3 flex justify-end">{switcher}</div>
        <Suspense fallback={null}>
          <SessionsAndLog />
        </Suspense>
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Admin", path: "/admin" }, { label: "Audit", path: "/admin/activity-browser" }, { label: "Activity Browser" }]} />
      <AdminShell title="Activity Browser" subtitle="What each person did: sign-ins, pages they opened, and everything they created, changed or deleted" icon={Activity} action={switcher}>
        <ActivityByUser />
      </AdminShell>
    </>
  );
}
