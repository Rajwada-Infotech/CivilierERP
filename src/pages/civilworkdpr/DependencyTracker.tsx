import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { Loader2, Search } from "lucide-react";
import { getDependencyMasters } from "@/api/dependencyMasterApi";
import { DependencyMasterList } from "@/pages/masters/DependencyMaster/components/DependencyMasterList";
import { usePageRights } from "@/hooks/usePageRights";

// Just the dependency chains defined in Engineering's Dependency Master
// (/masters/dependency) — nothing else. Reuses that page's own collapsible
// Project > Block > Floor > Unit > Room tree read-only rather than
// re-implementing it.
const DependencyTracker: React.FC = () => {
  usePageRights("civilworkdpr-dependency");
  const [search, setSearch] = useState("");
  const { data: dependencyMasters = [], isLoading } = useQuery({
    queryKey: ["dependencyMastersForCivilDpr"],
    queryFn: getDependencyMasters,
    staleTime: 60 * 1000,
  });

  const activeChains = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dependencyMasters.filter(
      (d) => d.isActive && (!q || d.alias.toLowerCase().includes(q) || d.scopePath.toLowerCase().includes(q)),
    );
  }, [dependencyMasters, search]);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Civil Work DPR", "Dependency"]} />
      <SheetShell
        eyebrow="CivilierERP · Civil Work DPR"
        title="Dependency management"
        subtitle="The activity chains set for each room, in the order the work has to be done. Open a room to see its chains."
      >
        <div className="bg-card" style={{ border: "1px solid hsl(var(--foreground))" }}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
            <p className="flex items-baseline gap-2.5">
              <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">Dependency chains</span>
              <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{activeChains.length}</span>
            </p>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                placeholder="Search alias or path…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 pl-8 pr-3 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </div>
          </div>
          <div className="p-2 sm:p-4">
        {isLoading ? (
          <div className="flex items-center gap-2 p-8 text-muted-foreground text-sm">
            <Loader2 size={16} className="animate-spin" /> Loading dependency chains…
          </div>
        ) : activeChains.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground text-sm">
            {search ? "No dependency chains match your search." : "No dependency chains defined yet."}
          </div>
        ) : (
          <DependencyMasterList
            rows={activeChains}
            canEdit={false}
            canDelete={false}
            onEdit={() => {}}
            onDelete={() => {}}
            forceExpand={!!search.trim()}
          />
        )}
          </div>
        </div>
      </SheetShell>
    </>
  );
};

export default DependencyTracker;
