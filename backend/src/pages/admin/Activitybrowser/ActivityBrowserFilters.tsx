// pages/admin/activity-browser/ActivityBrowserFilters.tsx
import React, { useCallback } from "react";
import { Calendar, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { PRESETS, YEARS, MONTHS } from "./constants";
import type {
  ActivityLogFilters,
  ActivityActionType,
} from "@/api/userActivityApi";

type Props = {
  search: string;
  setSearch: (value: string) => void;
  filterRole: "all" | "super_admin" | "admin" | "user";
  setFilterRole: (role: any) => void;
  quickFilter: ActivityActionType | null;
  setQuickFilter: (type: ActivityActionType | null) => void;
  dateRange: { from?: Date; to?: Date };
  setDateRange: (range: any) => void;
  dateFilters: any;
  setDateFilters: (filters: any) => void;
  clearDateFilters: () => void;
};

export const ActivityBrowserFilters: React.FC<Props> = ({
  search,
  setSearch,
  filterRole,
  setFilterRole,
  quickFilter,
  setQuickFilter,
  dateRange,
  setDateRange,
  dateFilters,
  setDateFilters,
  clearDateFilters,
}) => {
  const handlePresetClick = useCallback(
    (period: ActivityLogFilters["period"]) => {
      setDateFilters({ period });
    },
    [setDateFilters],
  );

  const handleDateRangeChange = useCallback(
    (range: { from?: Date; to?: Date }) => {
      setDateRange(range);
      if (range.from && range.to) {
        setDateFilters({
          dateFrom: format(range.from, "yyyy-MM-dd"),
          dateTo: format(range.to, "yyyy-MM-dd"),
        });
      } else if (range.from) {
        setDateFilters({ dateFrom: format(range.from, "yyyy-MM-dd") });
      } else {
        clearDateFilters();
      }
    },
    [setDateFilters, clearDateFilters],
  );

  const handleYearChange = useCallback(
    (yearStr: string) => {
      if (!yearStr) return;
      const year = parseInt(yearStr);
      const from = new Date(year, 0, 1);
      const to = new Date(year, 11, 31);
      setDateFilters({
        dateFrom: format(from, "yyyy-MM-dd"),
        dateTo: format(to, "yyyy-MM-dd"),
      });
    },
    [setDateFilters],
  );

  const handleMonthChange = useCallback(
    (monthStr: string) => {
      if (!monthStr) return;
      const month = parseInt(monthStr);
      const year = dateRange.from?.getFullYear() || new Date().getFullYear();
      const from = new Date(year, month, 1);
      const to = new Date(year, month + 1, 0);
      setDateFilters({
        dateFrom: format(from, "yyyy-MM-dd"),
        dateTo: format(to, "yyyy-MM-dd"),
      });
    },
    [setDateFilters, dateRange.from],
  );

  const handleQuickFilter = useCallback(
    (type: ActivityActionType) => {
      setQuickFilter(quickFilter === type ? null : type);
    },
    [setQuickFilter, quickFilter],
  );

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-3">
      {/* Quick Presets */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={dateFilters.period || ""}
          onValueChange={handlePresetClick}
        >
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue placeholder="Quick Select" />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map(({ label, period }) => (
              <SelectItem key={period} value={period} className="text-xs">
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select onValueChange={handleYearChange}>
          <SelectTrigger className="h-8 w-[80px] text-xs">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            {YEARS.map((y) => (
              <SelectItem key={y} value={y.toString()} className="text-xs">
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select onValueChange={handleMonthChange}>
          <SelectTrigger className="h-8 w-[110px] text-xs">
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m) => (
              <SelectItem
                key={m.value}
                value={m.value.toString()}
                className="text-xs"
              >
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-3 text-xs"
          onClick={clearDateFilters}
        >
          Clear
        </Button>

        <div className="flex items-center gap-1 border-l border-border pl-3 ml-1">
          {(["create", "update", "delete"] as ActivityActionType[]).map(
            (act) => (
              <Button
                key={act}
                variant={quickFilter === act ? "default" : "outline"}
                size="sm"
                className="h-7 text-[10px] uppercase tracking-wider"
                onClick={() => handleQuickFilter(act)}
              >
                {act}
              </Button>
            ),
          )}
        </div>
      </div>

      {/* Date Range Picker */}
      <div className="flex items-center gap-2 min-w-[280px]">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-[280px] justify-start text-left font-normal text-xs h-10",
                !dateRange.from && !dateRange.to && "text-muted-foreground",
              )}
            >
              <Calendar className="mr-2 h-4 w-4" />
              {dateRange.from ? (
                dateRange.to ? (
                  <>
                    {dateRange.from.toLocaleDateString("en-IN", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}{" "}
                    -{" "}
                    {dateRange.to.toLocaleDateString("en-IN", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </>
                ) : (
                  <>{format(dateRange.from, "PPP")} - Present</>
                )
              ) : (
                <span>Pick a date range</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarComponent
              initialFocus
              mode="range"
              defaultMonth={dateRange.from}
              selected={dateRange as any}
              onSelect={(range) =>
                handleDateRangeChange({
                  from: range?.from ?? new Date(),
                  to: range?.to,
                } as { from?: Date; to?: Date })
              }
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Search and Role */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] max-w-sm flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search user, fingerprint, resource, URL..."
            className="w-full py-2 pl-10 pr-4 text-sm"
          />
        </div>

        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value as typeof filterRole)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="all">All Roles</option>
          <option value="super_admin">Super Admin</option>
          <option value="admin">Admin</option>
          <option value="user">User</option>
        </select>
      </div>
    </div>
  );
};
