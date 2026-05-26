with open('src/api/homeDashboardApi.ts', 'rb') as f:
    c = f.read()

old = b'export async function fetchHomeDashboard(\r\n  isAdmin: boolean,\r\n): Promise<HomeDashboardData> {\r\n  const baseRequests = [\r\n    safeFetch<FinanceDashboardApiData>("/api/finance-dashboard"),'
new = b'const FINANCE_ROLES = ["admin", "super_admin", "dba", "finance_manager", "branch_manager"];\r\n\r\nexport async function fetchHomeDashboard(\r\n  isAdmin: boolean,\r\n  role?: string,\r\n): Promise<HomeDashboardData> {\r\n  const hasFinanceAccess = FINANCE_ROLES.includes(role ?? "");\r\n  const baseRequests = [\r\n    hasFinanceAccess\r\n      ? safeFetch<FinanceDashboardApiData>("/api/finance-dashboard")\r\n      : Promise.resolve({ data: null, error: null }),'

if old in c:
    c = c.replace(old, new, 1)
    print("Replaced CRLF")
else:
    old_lf = old.replace(b'\r\n', b'\n')
    new_lf = new.replace(b'\r\n', b'\n')
    if old_lf in c:
        c = c.replace(old_lf, new_lf, 1)
        print("Replaced LF")
    else:
        print("NO MATCH")
        idx = c.find(b'fetchHomeDashboard')
        print(repr(c[idx:idx+120]))

with open('src/api/homeDashboardApi.ts', 'wb') as f:
    f.write(c)