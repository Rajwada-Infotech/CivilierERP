export type ProjectCompanyLike = {
  company_id?: string | number | null;
  companyId?: string | number | null;
  CompanyId?: string | number | null;
  belongs_to?: string | number | null;
  belongsTo?: string | number | null;
  company_ids?: string | number[] | null;
  companyIds?: string | number[] | null;
  CompanyIds?: string | number[] | null;
  // Extra companies the project is tagged to via Project Master's
  // multi-company tagging (dbo.ProjectCompanies), comma-separated.
  tagged_company_ids?: string | number[] | null;
  MultiCompanyIds?: string | number[] | null;
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
  const ids = [
    ...splitIds(project.company_ids),
    ...splitIds(project.companyIds),
    ...splitIds(project.CompanyIds),
    ...splitIds(project.company_id),
    ...splitIds(project.companyId),
    ...splitIds(project.CompanyId),
    ...splitIds(project.belongs_to),
    ...splitIds(project.belongsTo),
    ...splitIds(project.tagged_company_ids),
    ...splitIds(project.MultiCompanyIds),
  ];
  return Array.from(new Set(ids));
}

export function projectBelongsToCompany(
  project: ProjectCompanyLike,
  companyId: string | number | null | undefined,
): boolean {
  if (companyId == null || companyId === "") return true;
  return projectCompanyIds(project).includes(String(companyId));
}

export function filterProjectsByCompany<T extends ProjectCompanyLike>(
  projects: T[],
  companyId: string | number | null | undefined,
): T[] {
  return projects.filter((project) =>
    projectBelongsToCompany(project, companyId),
  );
}
