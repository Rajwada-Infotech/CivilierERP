with open('src/contexts/RecordsContext.tsx', 'rb') as f:
    c = f.read()

old = b'  const FINANCE_ROLES = ["admin", "super_admin", "dba", "finance", "accounts"];'
new = b'  const FINANCE_ROLES = ["admin", "super_admin", "dba", "finance_manager", "branch_manager"];'

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
        idx = c.find(b'FINANCE_ROLES')
        print(repr(c[idx:idx+80]))

with open('src/contexts/RecordsContext.tsx', 'wb') as f:
    f.write(c)