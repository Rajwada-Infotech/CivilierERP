// Which widget-bearing module a URL belongs to, or null for anything else
// (Home, admin, masters, the customer portal...). Matches whole path
// segments so "/crm-client-portal" is never mistaken for "/crm".
const PREFIXES: [string, string][] = [
  ["/finance", "Finance"],
  ["/material", "Material"],
  ["/engineering", "Engineering"],
  ["/crm", "CRM"],
];

export function moduleOfPath(pathname: string): string | null {
  for (const [prefix, module] of PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return module;
  }
  return null;
}
