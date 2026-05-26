with open('src/contexts/RecordsContext.tsx', 'rb') as f:
    c = f.read()

old = b'  const isCustomer = !currentUser || currentUser.role === "customer";'
new = b'  // Only fetch for roles that have Finance module access.\r\n  // Others (customer, engineer, site_engineer, etc.) get 403 on these endpoints.\r\n  const FINANCE_ROLES = ["admin", "super_admin", "dba", "finance", "accounts"];\r\n  const isCustomer = !currentUser || !FINANCE_ROLES.includes(currentUser.role);'

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
        idx = c.find(b'isCustomer')
        print(repr(c[idx:idx+80]))

with open('src/contexts/RecordsContext.tsx', 'wb') as f:
    f.write(c)