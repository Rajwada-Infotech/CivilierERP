// Re-exported from the API layer so components only ever import from one
// place — src/api/dependencyMasterApi.ts stays the single source of truth
// for shapes the backend actually returns/accepts.
export type {
  WorkType,
  ScopeOption,
  DependencyScope,
  LadderActivity,
  DependencyMasterPayload,
  DependencyMasterListRow,
  DependencyMasterDetail,
} from "@/api/dependencyMasterApi";
