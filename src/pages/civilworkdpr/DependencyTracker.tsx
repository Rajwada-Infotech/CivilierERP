import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { GitBranch, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
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
      <CivilWorkDprShell title="Dependency Management" icon={GitBranch}>
        <div className="flex justify-end">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search alias or path…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 w-64"
            />
          </div>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 p-8 text-muted-foreground text-sm">
            <Loader2 size={16} className="animate-spin" /> Loading dependency chains…
          </div>
        ) : activeChains.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground text-sm">
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
      </CivilWorkDprShell>
    </>
  );
};

export default DependencyTracker;
