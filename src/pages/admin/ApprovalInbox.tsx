import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { AdminShell } from "@/components/admin/AdminShell";
import { ClipboardCheck, Receipt, RefreshCw, Inbox, SlidersHorizontal, ArrowDownWideNarrow, ArrowUpWideNarrow, Search, X, ChevronDown, ChevronRight } from "lucide-react";
import { MultiSelectDropdown, type MultiSelectOption } from "@/components/ui/MultiSelectDropdown";
import { InboxItem, MODULE_CONFIG, ALL_MODULES, CATEGORY_META, CATEGORY_ORDER, categoryOf, DISPLAY_GROUP, MODULE_ORDER, moduleOrderOf, fetchInbox } from "./approvalInbox/config";
import { InboxRow } from "./approvalInbox/InboxRow";

// The module catalogue and helpers live in ./approvalInbox/config; re-exported here because
// ApprovalReviewPanel (and anything older) imports them from this file.
export * from "./approvalInbox/config";

// ─── Main Page ────────────────────────────────────────────────────────────────

const ApprovalInbox: React.FC = () => {
  const queryClient = useQueryClient();
  const rights = usePageRights("approval-inbox");
  // Multi-select, nested-by-category filter — replaces the old single-select
  // module tabs so an approver can pick e.g. "PO + GRN + Payment" at once
  // instead of flipping between one module at a time. Empty = every module.
  const [activeModules, setActiveModules] = useState<string[]>([]);
  const [dateSort, setDateSort] = useState<"desc" | "asc">("desc");
  // Free-text search over each item's own document number — separate from
  // the module-type filter above, which only ever matched module *names*
  // (e.g. "Journal Voucher"), not a document's Reference like
  // "JV-2026-00067". Typing a doc number into that filter's search box
  // matched nothing, which is what "document search isn't working" meant.
  const [docSearch, setDocSearch] = useState("");
  // Which module groups (Material Request, Purchase Order, GRN, ...) are
  // expanded — collapsed by default, same reasoning as Work Allocation's
  // dependency chains: 64 flat rows across a dozen module types was the
  // actual complaint, not any one type's own row count. Keyed by category+
  // module so two different categories' same-named module (there are none
  // today, but nothing should assume it) can never collide.
  const [expandedModuleGroups, setExpandedModuleGroups] = useState<Set<string>>(new Set());
  const toggleModuleGroup = (key: string) =>
    setExpandedModuleGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const {
    data: allItems = [],
    dataUpdatedAt,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ["approval-inbox"],
    queryFn: fetchInbox,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());

  // Approving/rejecting hides a row immediately (before the refetch this
  // same action triggers has actually landed) by key, keyed on Module +
  // RecordId. For most modules RecordId is stable forever once acted on,
  // so that's fine — but civilworkdpr-approval's RecordId is the RUNG id,
  // which is deliberately the SAME across every rework attempt of that
  // rung (see approvalInbox.js's own comment on that module). Without
  // this reset, rejecting attempt 1 permanently hid every later attempt
  // of the same rung from this session's inbox — including a fully
  // legitimate attempt 2 that QC re-approved and that genuinely needs
  // review — since removedKeys never had a reason to forget that key.
  // Any fresh fetch is authoritative for what's actually pending right
  // now, so it's always safe to drop the whole overlay once one lands.
  const lastClearedFetchRef = useRef(dataUpdatedAt);
  useEffect(() => {
    if (dataUpdatedAt !== lastClearedFetchRef.current) {
      lastClearedFetchRef.current = dataUpdatedAt;
      setRemovedKeys(new Set());
    }
  }, [dataUpdatedAt]);

  const items = (
    activeModules.length > 0
      ? allItems.filter((i) => activeModules.includes(i.Module))
      : allItems
  )
    .filter((i) => !removedKeys.has(`${i.Module}-${i.RecordId}`))
    .filter((i) => {
      const q = docSearch.trim().toLowerCase();
      if (!q) return true;
      return (i.Reference ?? "").toLowerCase().includes(q) || String(i.RecordId).includes(q);
    })
    // Grouped by module first (all Material Requests together, then all
    // Purchase Orders, then all GRNs, etc. — MODULE_ORDER below) so like
    // documents sit together instead of interleaving by date across
    // modules within the same category. Sorted by the record's own date
    // within each module, not the backend's LastModified order — a
    // document dated last month that was only just resubmitted shouldn't
    // outrank one genuinely raised yesterday.
    .sort((a, b) => {
      const moduleDelta = moduleOrderOf(a.Module) - moduleOrderOf(b.Module);
      if (moduleDelta !== 0) return moduleDelta;
      const da = a.RecordDate ? new Date(a.RecordDate).getTime() : 0;
      const db = b.RecordDate ? new Date(b.RecordDate).getTime() : 0;
      return dateSort === "desc" ? db - da : da - db;
    });

  // Group by category (Material, Finance, Engineering, Sales/CRM, Admin) so
  // like modules — MR/PO/GRN under Material, Payment/JV under Finance, etc. —
  // sit together in the list, in a fixed category order. Within a category,
  // the date sort above is preserved.
  const groupedItems = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: items.filter((i) => categoryOf(i.Module) === cat),
  })).filter((g) => g.items.length > 0);

  // Feeds the nested filter dropdown — every module, grouped by its business
  // category, with a live pending-count hint per option.
  const moduleFilterOptions: MultiSelectOption[] = ALL_MODULES.map((mod) => ({
    id: mod,
    label: MODULE_CONFIG[mod].label,
    group: CATEGORY_META[categoryOf(mod)].label,
    hint: String(allItems.filter((i) => i.Module === mod).length || ""),
  }));

  const handleOptimisticUpdate = (recordId: string, module: string) => {
    setRemovedKeys((prev) => new Set(prev).add(`${module}-${recordId}`));
  };

  const handleActionDone = () => {
    queryClient.invalidateQueries({ queryKey: ["approval-inbox"] });
    queryClient.invalidateQueries({ queryKey: ["payments"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["boqs"], exact: false });
    // CRM booking financial data — milestone AmountPaid, money receipts, and
    // on-account balance all update when Finance approves a Received Payment
    // or Money Receipt. Without these, a booking detail open in another tab
    // shows stale figures (e.g. milestone still showing balance after payment clears).
    queryClient.invalidateQueries({ queryKey: ["crm-booking-detail"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["crm-booking-money-receipts"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["crm-booking-on-account"], exact: false });
    // Signal sidebar to immediately re-poll the pending-count badge.
    window.dispatchEvent(new CustomEvent("approval-action"));
  };

  const totalCount = allItems.length;

  return (
    <>
      <Breadcrumbs items={["Approvals", "Inbox"]} />

      <AdminShell
        title="Approval Inbox"
        subtitle="All records awaiting your approval across every module"
        icon={Inbox}
        action={
          <div className="flex items-center gap-2">
            {totalCount > 0 && (
              <span className="bg-red-500 text-white text-[0.6875rem] font-bold min-w-[22px] h-[22px] flex items-center justify-center rounded-full leading-none">
                {totalCount}
              </span>
            )}
            <button
              onClick={() => refetch()}
              disabled={isRefetching}
              className="group flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-all duration-200 active:scale-90 disabled:opacity-50 shrink-0"
              title="Refresh"
            >
              <RefreshCw
                size={13}
                className={`transition-transform duration-500 ${isRefetching ? "animate-spin" : "group-hover:rotate-180"}`}
              />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        }
      >
        {/* Nested filter — every approval type, grouped by its business
            category (Material/Finance/Engineering/Sales-CRM), multi-select
            so several types (e.g. PO + GRN + Payment) can be picked at once
            instead of one module at a time. Paired with a date-sort toggle
            since "filter, then sort" is how this list is actually worked. */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={docSearch}
            onChange={(e) => setDocSearch(e.target.value)}
            placeholder="Search by document number (e.g. JV-2026-00067)…"
            className="w-full pl-9 pr-9 py-2.5 text-sm rounded-xl bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {docSearch && (
            <button
              type="button"
              onClick={() => setDocSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <div className="rounded-xl border border-border bg-muted/30 p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <SlidersHorizontal size={12} />
              Filter by type
            </span>
            <button
              onClick={() => setDateSort((s) => (s === "desc" ? "asc" : "desc"))}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[0.6875rem] font-medium border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Toggle date sort order"
            >
              {dateSort === "desc" ? (
                <ArrowDownWideNarrow size={12} />
              ) : (
                <ArrowUpWideNarrow size={12} />
              )}
              {dateSort === "desc" ? "Newest first" : "Oldest first"}
            </button>
          </div>
          <MultiSelectDropdown
            options={moduleFilterOptions}
            value={activeModules}
            onChange={setActiveModules}
            placeholder="All approval types"
            searchPlaceholder="Search PO, GRN, Payment…"
            itemNoun="type"
          />
        </div>

        {/* Content */}
        <div className="rounded-xl border border-border bg-card">
          {isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-4 py-3.5 animate-pulse"
                >
                  <div className="w-8 h-8 rounded-lg bg-muted shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-32 rounded bg-muted" />
                    <div className="h-2.5 w-24 rounded bg-muted" />
                  </div>
                  <div className="h-6 w-20 rounded-full bg-muted" />
                  <div className="h-7 w-24 rounded-lg bg-muted" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <Inbox size={24} className="text-muted-foreground/40" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                {docSearch.trim()
                  ? `No document matches "${docSearch.trim()}"`
                  : activeModules.length > 0
                    ? "No pending items for the selected type(s)"
                    : "All clear!"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {docSearch.trim()
                  ? "Clear the search to see the full inbox"
                  : activeModules.length > 0
                    ? "Clear the filter to see the full inbox"
                    : "No records are awaiting approval right now"}
              </p>
            </div>
          ) : (
            <div className="ai-wrap">
              {/* Desktop table header */}
              <div className="ai-head hidden items-center border-b border-border rounded-t-xl bg-muted/40">
                <div className="w-[3px] shrink-0 self-stretch" />
                <div className="ai-row ai-row-head flex-1 grid gap-2 pl-3 pr-4 py-2.5">
                {[
                  "Module / Ref",
                  "Date",
                  "Party / Transfer",
                  "Project",
                  "Amount",
                  "Approved / Rejected By",
                  "Status",
                  "Actions",
                ].map((h) => (
                  <p
                    key={h}
                    className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground"
                  >
                    {h}
                  </p>
                ))}
                </div>
              </div>

              <div>
                {groupedItems.map(({ cat, items: catItems }) => (
                  <div key={cat}>
                    {/* Category section header — only worth showing when the
                        current result set spans more than one category; a
                        filter narrow enough to leave just one category on
                        screen makes the header redundant. */}
                    {groupedItems.length > 1 && (
                      <div className="sticky top-0 z-[1] flex items-center gap-1.5 px-4 py-1.5 bg-muted/60 backdrop-blur-sm border-b border-border">
                        <span className={`text-[0.625rem] font-bold uppercase tracking-wider ${CATEGORY_META[cat].color}`}>
                          {CATEGORY_META[cat].label}
                        </span>
                        <span className="text-[0.625rem] text-muted-foreground">({catItems.length})</span>
                      </div>
                    )}
                    {(() => {
                      // Group this category's items by Module, preserving
                      // the order they already arrive in (moduleOrderOf,
                      // then date within a module) — a Map iterates in
                      // insertion order, so the first item of each module
                      // fixes that module's position in the list.
                      const byModule = new Map<string, InboxItem[]>();
                      for (const item of catItems) {
                        // A refund payout IS a payment: it is listed under
                        // Payments (it still approves through its own rule).
                        const key = DISPLAY_GROUP[item.Module] ?? item.Module;
                        if (!byModule.has(key)) byModule.set(key, []);
                        byModule.get(key)!.push(item);
                      }
                      return Array.from(byModule.entries()).map(([mod, modItems]) => {
                        const groupKey = `${cat}:${mod}`;
                        const expanded = expandedModuleGroups.has(groupKey);
                        const cfg = MODULE_CONFIG[mod];
                        const Icon = cfg?.icon ?? ClipboardCheck;
                        return (
                          <div key={groupKey}>
                            <button
                              type="button"
                              onClick={() => toggleModuleGroup(groupKey)}
                              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-muted/20 transition-colors border-b border-border/60"
                            >
                              {expanded ? (
                                <ChevronDown size={13} className="text-muted-foreground shrink-0" />
                              ) : (
                                <ChevronRight size={13} className="text-muted-foreground shrink-0" />
                              )}
                              <div className={`p-1.5 rounded-lg shrink-0 ${cfg?.color ?? "bg-muted text-muted-foreground"}`}>
                                <Icon size={13} />
                              </div>
                              <span className="text-sm font-semibold text-foreground">
                                {cfg?.label ?? mod}
                              </span>
                              <span className="text-[0.6875rem] text-muted-foreground">
                                ({modItems.length})
                              </span>
                            </button>
                            {expanded &&
                              modItems.map((item) => (
                                <InboxRow
                                  key={`${item.Module}-${item.RecordId}`}
                                  item={item}
                                  onActionDone={handleActionDone}
                                  onOptimisticUpdate={handleOptimisticUpdate}
                                />
                              ))}
                          </div>
                        );
                      });
                    })()}
                  </div>
                ))}
              </div>

              <div className="px-4 py-2.5 border-t border-border bg-muted/20 rounded-b-xl">
                <p className="text-[0.6875rem] text-muted-foreground">
                  {items.length} record{items.length !== 1 ? "s" : ""} pending
                  approval
                  {activeModules.length > 0 &&
                    ` — ${activeModules.map((m) => MODULE_CONFIG[m]?.label ?? m).join(", ")}`}
                </p>
              </div>
            </div>
          )}
        </div>
      </AdminShell>
    </>
  );
};

export default ApprovalInbox;
