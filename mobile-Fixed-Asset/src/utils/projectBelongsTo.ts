// Mirror of the web app's src/lib/projectBelongsTo.ts. A project belongs to its
// own company_id AND to every company it is tagged to in Project Master's
// multi-company tagging (tagged_company_ids, comma-separated).

export type ProjectCompanyLike = {
  company_id?: string | number | null;
  companyId?: string | number | null;
  tagged_company_ids?: string | number[] | null;
};

const splitIds = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value == null || value === "") return [];
  return String(value)
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
};

export function projectCompanyIds(project: ProjectCompanyLike): string[] {
  return Array.from(
    new Set([...splitIds(project.company_id), ...splitIds(project.companyId), ...splitIds(project.tagged_company_ids)]),
  );
}

/** With no company chosen yet every project is listed, matching the web forms. */
export function projectBelongsToCompany(project: ProjectCompanyLike, companyId: string | number | null | undefined): boolean {
  if (companyId == null || companyId === "") return true;
  return projectCompanyIds(project).includes(String(companyId));
}

export function filterProjectsByCompany<T extends ProjectCompanyLike>(projects: T[], companyId: string | number | null | undefined): T[] {
  return projects.filter((p) => projectBelongsToCompany(p, companyId));
}
