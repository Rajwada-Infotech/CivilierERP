import type { DependencyMasterListRow } from "@/api/dependencyMasterApi";
import { useDependencyMasterList } from "../hooks/useDependencyMasterList";
import { DependencyMasterListItem } from "./DependencyMasterListItem";

interface Props {
  rows: DependencyMasterListRow[];
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (row: DependencyMasterListRow) => void;
  onDelete: (row: DependencyMasterListRow) => void;
}

// Maps the list rows, each independent Dependency Master entry — different
// projects, same project, any mix — and owns the shared expand/cache state
// so only one row's chain fetch is ever in flight from a single toggle.
export function DependencyMasterList({ rows, canEdit, canDelete, onEdit, onDelete }: Props) {
  const list = useDependencyMasterList();

  return (
    <div>
      {rows.map((row) => (
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
  );
}
