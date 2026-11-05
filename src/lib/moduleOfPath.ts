// Which Home module a URL belongs to, or null for anything else (Home, admin,
// masters, the customer portal...). Ids match Home's module access keys.
// Matches whole path segments so "/crm-client-portal" is never mistaken for
// "/crm", nor "/sales-automation" for "/sales".
const PREFIXES: [string, string][] = [
  ["/finance", "finance"],
  ["/material", "material"],
  ["/engineering", "engineering"],
  ["/followup", "followup"],
  ["/ticket", "ticket"],
  ["/sales-automation", "salesAutomation"],
  ["/sales", "sales"],
  ["/civilworkdpr", "civilworkdpr"],
  ["/crm", "crm"],
  ["/fixed-asset", "fixedasset"],
];

export function moduleOfPath(pathname: string): string | null {
  for (const [prefix, module] of PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return module;
  }
  return null;
}
