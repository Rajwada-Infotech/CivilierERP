import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { GitBranch, Loader2 } from "lucide-react";
import { getDependencyMasters } from "@/api/dependencyMasterApi";
import { useDependencyMasterList } from "@/pages/masters/DependencyMaster/hooks/useDependencyMasterList";
import { DependencyMasterListItem } from "@/pages/masters/DependencyMaster/components/DependencyMasterListItem";

// Just the dependency chains defined in Engineering's Dependency Master
// (/masters/dependency) — nothing else. Reuses that page's own list-row +
// expand-to-chain components read-only rather than re-implementing them.
const DependencyTracker: React.FC = () => {
  const { data: dependencyMasters = [], isLoading } = useQuery({
    queryKey: ["dependencyMastersForCivilDpr"],
    queryFn: getDependencyMasters,
    staleTime: 60 * 1000,
  });
  const depList = useDependencyMasterList();
  const activeChains = dependencyMasters.filter((d) => d.isActive);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Civil Work DPR", "Dependency"]} />
      <CivilWorkDprShell title="Dependency Management" icon={GitBranch}>
        {isLoading ? (
          <div className="flex items-center gap-2 p-8 text-muted-foreground text-sm">
            <Loader2 size={16} className="animate-spin" /> Loading dependency chains…
          </div>
        ) : activeChains.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground text-sm">
            No dependency chains defined yet.
          </div>
        ) : (
          <div className="space-y-2">
            {activeChains.map((row) => (
              <DependencyMasterListItem
                key={row.id}
                row={row}
                isExpanded={depList.expandedId === row.id}
                isLoading={depList.loadingId === row.id}
                cached={depList.getCached(row.id)}
                onToggle={() => depList.toggle(row.id)}
                canEdit={false}
                canDelete={false}
                onEdit={() => {}}
                onDelete={() => {}}
              />
            ))}
          </div>
        )}
      </CivilWorkDprShell>
    </>
  );
};

export default DependencyTracker;
