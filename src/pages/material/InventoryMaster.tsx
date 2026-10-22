// Inventory Master: the godowns, each with its stock. Parts under ./inventoryMaster:
//   config (field, input style) · GodownDrawer (new / edit) · DeleteDialog · GodownStockPanel · GodownCard · EmptyState
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Warehouse, Plus, X, Check, AlertCircle, RefreshCw, Search } from "lucide-react";
import { getGodowns, type Godown } from "@/api/godownsApi";
import { MaterialShell } from "@/components/material/MaterialShell";
import { usePageRights } from "@/hooks/usePageRights";
import { GodownDrawer } from "./inventoryMaster/GodownDrawer";
import { DeleteDialog } from "./inventoryMaster/DeleteDialog";
import { GodownStockPanel } from "./inventoryMaster/GodownStockPanel";
import { GodownCard } from "./inventoryMaster/GodownCard";
import { EmptyState } from "./inventoryMaster/EmptyState";

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function InventoryMaster() {
  const rights = usePageRights("inventory-master");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingGodown, setEditingGodown] = useState<Godown | null>(null);
  const [deletingGodown, setDeletingGodown] = useState<Godown | null>(null);
  const [stockGodown, setStockGodown] = useState<Godown | null>(null);
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["godowns"],
    queryFn: getGodowns,
    staleTime: 60_000,
  });

  const godowns: Godown[] = data?.data ?? [];

  const filtered = search.trim()
    ? godowns.filter(
        (g) =>
          g.GodownName.toLowerCase().includes(search.toLowerCase()) ||
          g.GodownCode?.toLowerCase().includes(search.toLowerCase()) ||
          g.ShortDesc?.toLowerCase().includes(search.toLowerCase()),
      )
    : godowns;

  // Sort alphabetically
  const sorted = [...filtered].sort((a, b) => {
    return a.GodownName.localeCompare(b.GodownName);
  });

  const handleEdit = (g: Godown) => {
    setEditingGodown(g);
    setDrawerOpen(true);
  };

  const handleAdd = () => {
    setEditingGodown(null);
    setDrawerOpen(true);
  };

  const handleDrawerClose = () => {
    setDrawerOpen(false);
    setEditingGodown(null);
  };

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Material Module", "Inventory Master"]}
      />

      <GodownDrawer
        open={drawerOpen}
        onClose={handleDrawerClose}
        editing={editingGodown}
      />
      <DeleteDialog
        godown={deletingGodown}
        onClose={() => setDeletingGodown(null)}
      />

      <MaterialShell
        title="Inventory Master"
        subtitle="Manage godowns and stock locations"
        icon={Warehouse}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="p-2 rounded-lg border border-emerald-500/30 hover:bg-emerald-500/10 transition-colors"
              title="Refresh"
              style={{ color: "#34d399" }}
            >
              <RefreshCw
                size={14}
                className={isLoading ? "animate-spin" : ""}
              />
            </button>
            {rights.canCreate && (
            <button
              onClick={handleAdd}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-emerald-500/30 hover:bg-emerald-500/10 text-sm font-semibold transition-colors"
              style={{ color: "#34d399" }}
            >
              <Plus size={14} /> New Godown
            </button>
            )}
          </div>
        }
      >
        {/* ── Stats strip ── */}
        {!isLoading && godowns.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-card text-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="font-heading font-bold text-foreground">
                {godowns.length}
              </span>
              <span className="text-muted-foreground text-xs">
                Project Godowns
              </span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-card text-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="font-heading font-bold text-foreground">
                {godowns.filter((g) => g.IsActive).length}
              </span>
              <span className="text-muted-foreground text-xs">Active</span>
            </div>
            {godowns.some((g) => g.EnterpriseName) && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-card text-sm">
                <span className="w-2 h-2 rounded-full bg-violet-500" />
                <span className="font-heading font-bold text-foreground">
                  {
                    new Set(
                      godowns.map((g) => g.EnterpriseName).filter(Boolean),
                    ).size
                  }
                </span>
                <span className="text-muted-foreground text-xs">Companies</span>
              </div>
            )}
          </div>
        )}

        {/* ── Search ── */}
        {godowns.length > 0 && (
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-border bg-card w-full max-w-sm">
            <Search size={14} className="text-muted-foreground shrink-0" />
            <input
              type="text"
              placeholder="Search godowns…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none flex-1"
            />
            {search && (
              <button onClick={() => setSearch("")}>
                <X
                  size={13}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                />
              </button>
            )}
          </div>
        )}

        {/* ── Error ── */}
        {isError && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
            <AlertCircle size={15} />
            Failed to load godowns. Check your connection and try again.
          </div>
        )}

        {/* ── Loading skeletons ── */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border border-border bg-card overflow-hidden"
              >
                <div className="h-1 bg-muted animate-pulse" />
                <div className="p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-muted animate-pulse shrink-0" />
                    <div className="space-y-2 flex-1">
                      <div className="h-3 bg-muted rounded animate-pulse w-3/4" />
                      <div className="h-2.5 bg-muted rounded animate-pulse w-1/3" />
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <div className="h-6 w-16 bg-muted rounded-lg animate-pulse" />
                    <div className="h-6 w-20 bg-muted rounded-lg animate-pulse" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Empty state ── */}
        {!isLoading && godowns.length === 0 && <EmptyState onAdd={handleAdd} />}

        {/* ── Grid ── */}
        {!isLoading && sorted.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sorted.map((g) => (
              <React.Fragment key={g.GodownID}>
                <GodownCard
                  godown={g}
                  onEdit={handleEdit}
                  onDelete={setDeletingGodown}
                  onView={(clicked) =>
                    setStockGodown((prev) =>
                      prev?.GodownID === clicked.GodownID ? null : clicked,
                    )
                  }
                  canEdit={rights.canEdit}
                  canDelete={rights.canDelete}
                />
                {stockGodown?.GodownID === g.GodownID && (
                  <GodownStockPanel
                    godown={g}
                    onClose={() => setStockGodown(null)}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* ── No search results ── */}
        {!isLoading && godowns.length > 0 && sorted.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">
              No godowns match{" "}
              <span className="font-semibold text-foreground">"{search}"</span>
            </p>
            <button
              onClick={() => setSearch("")}
              className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              Clear search
            </button>
          </div>
        )}
      </MaterialShell>
    </>
  );
}
