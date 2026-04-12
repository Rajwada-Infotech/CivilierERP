// pages/admin/activity-browser/ActivityBrowser.tsx
import React, { useState, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useActivityBrowser } from "@/contexts/ActivityBrowserContext";
import type { ActivityActionType } from "@/api/userActivityApi";

import { ActivityBrowserFilters } from "./ActivityBrowserFilters";
import { ActivityBrowserAnalytics } from "./ActivityBrowserAnalytics";
import { ActivityBrowserChart } from "./ActivityBrowserChart";
import { ActivityBrowserTabs } from "./ActivityBrowserTabs";
import { ActivityBrowserPagination } from "./ActivityBrowserPagination";
import { ActivityBrowserSummary } from "./ActivityBrowserSummary";

const ActivityBrowser: React.FC = () => {
  const {
    groupedSessions,
    rawSessions,
    isLoading,
    dateFilters,
    setDateFilters,
    clearDateFilters,
    activity,
    setPage,
    setFilters,
  } = useActivityBrowser();

  const [activeTab, setActiveTab] = useState<"sessions" | "actions">(
    "sessions",
  );
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<
    "all" | "super_admin" | "admin" | "user"
  >("all");
  const [quickFilter, setQuickFilter] = useState<ActivityActionType | null>(
    null,
  );

  const [dateRange, setDateRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({
    from: dateFilters.dateFrom ? new Date(dateFilters.dateFrom) : undefined,
    to: dateFilters.dateTo ? new Date(dateFilters.dateTo) : undefined,
  });

  // Fix for infinite loop: Sync only when dateFilters changes externally
  useEffect(() => {
    setDateRange({
      from: dateFilters.dateFrom
        ? new Date(dateFilters.dateFrom + "T00:00:00")
        : undefined,
      to: dateFilters.dateTo
        ? new Date(dateFilters.dateTo + "T00:00:00")
        : undefined,
    });
  }, [dateFilters.dateFrom, dateFilters.dateTo]);

  // Debounced filters
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters({
        search: search.trim() || undefined,
        role: filterRole === "all" ? undefined : filterRole,
      });
    }, 400);

    return () => clearTimeout(timer);
  }, [search, filterRole, setFilters]);

  return (
    <div className="space-y-6 p-6">
      <Breadcrumbs
        items={[
          { label: "Admin", path: "/admin" },
          { label: "Audit", path: "/admin/activity-browser" },
          { label: "Session Dashboard" },
        ]}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">
            Activity Browser
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Login, logout, device fingerprint and everything changed during each
            session.
          </p>
        </div>
        <div className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
          {groupedSessions.length} sessions ·{" "}
          {rawSessions.filter((e) => e.event === "action").length} actions
        </div>
      </div>

      <ActivityBrowserFilters
        search={search}
        setSearch={setSearch}
        filterRole={filterRole}
        setFilterRole={setFilterRole}
        quickFilter={quickFilter}
        setQuickFilter={setQuickFilter}
        dateRange={dateRange}
        setDateRange={setDateRange}
        dateFilters={dateFilters}
        setDateFilters={setDateFilters}
        clearDateFilters={clearDateFilters}
      />

      {!isLoading && (
        <>
          <ActivityBrowserAnalytics rawSessions={rawSessions} />
          <ActivityBrowserChart
            rawSessions={rawSessions}
            dateRange={dateRange}
          />
        </>
      )}

      <ActivityBrowserTabs
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        search={search}
        filterRole={filterRole}
        quickFilter={quickFilter}
        groupedSessions={groupedSessions}
        rawSessions={rawSessions}
      />

      <ActivityBrowserPagination
        activity={activity}
        setPage={setPage}
        isLoading={isLoading}
      />

      {!isLoading && (
        <ActivityBrowserSummary
          groupedSessions={groupedSessions}
          rawSessions={rawSessions}
        />
      )}
    </div>
  );
};

export default ActivityBrowser;
