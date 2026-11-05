import React, { lazy, Suspense, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import ActivityByUser from "./ActivityByUser";

// The original session/log browser stays available as a second view.
const SessionsAndLog = lazy(() => import("./ActivityBrowser"));

export default function ActivityBrowserHome() {
  const [view, setView] = useState<"user" | "log">("user");

  const switcher = (
    <div className="inline-flex items-stretch border border-foreground">
      {([["user", "By user"], ["log", "Sessions & log"]] as const).map(([key, label], i) => (
        <button
          key={key}
          onClick={() => setView(key)}
          aria-pressed={view === key}
          className={`h-9 px-4 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors ${i ? "border-l border-foreground" : ""} ${
            view === key ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <Breadcrumbs items={[{ label: "Admin", path: "/admin" }, { label: "Audit", path: "/admin/activity-browser" }, { label: "Activity Browser" }]} />
      <SheetShell
        eyebrow="CivilierERP · Admin · Audit"
        title="Activity browser"
        subtitle="What each person did: sign-ins, pages they opened, and everything they created, changed, approved or deleted."
        action={switcher}
      >
        {view === "user" ? (
          <ActivityByUser />
        ) : (
          <Suspense fallback={<p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>}>
            <SessionsAndLog />
          </Suspense>
        )}
      </SheetShell>
    </>
  );
}
