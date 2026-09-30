import type { DependencyMasterListRow } from "@/api/dependencyMasterApi";
import { useDependencyMasterList } from "../hooks/useDependencyMasterList";
import { DependencyMasterListItem } from "./DependencyMasterListItem";
import { ScopeLocationTree } from "@/components/civilworkdpr/ScopeLocationTree";

interface Props {
  rows: DependencyMasterListRow[];
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (row: DependencyMasterListRow) => void;
  onDelete: (row: DependencyMasterListRow) => void;
  /** Open every level (e.g. while a search is active, so matches are visible). */
  forceExpand?: boolean;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function DependencyMasterList({ rows, canEdit, canDelete, onEdit, onDelete, forceExpand = false }: Props) {
  const list = useDependencyMasterList();

  return (
    <ScopeLocationTree
      rows={rows}
      countLabel="chain"
      forceExpand={forceExpand}
      renderLeaf={(items) => (
        <div className="space-y-1.5 py-1">
          {[...items].sort((a, b) => collator.compare(a.alias, b.alias)).map((row) => (
            <DependencyMasterListItem
              key={row.id}
              row={row}
              isExpanded={list.expandedId === row.id}
              isLoading={list.loadingId === row.id}
              cached={list.getCached(row.id)}
              onToggle={() => list.toggle(row.id)}
              canEdit={canEdit}
              canDelete={canDelete}
              onEdit={() => onEdit(row)}
              onDelete={() => onDelete(row)}
            />
          ))}
        </div>
      )}
    />
  );
}
