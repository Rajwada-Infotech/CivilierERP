with open('src/hooks/useReminders.ts', 'rb') as f:
    c = f.read()

old = b'  const [, emiItems, mrItems] = await Promise.all([\r\n    Promise.all(['
new = b'  const FINANCE_ROLES = ["admin", "super_admin", "dba", "finance_manager", "branch_manager"];\r\n  const hasFinanceAccess = FINANCE_ROLES.includes(role || "");\r\n  const [, emiItems, mrItems] = await Promise.all([\r\n    Promise.all(['

if old in c:
    c = c.replace(old, new, 1)
    print("Replaced CRLF - part 1")
else:
    old_lf = old.replace(b'\r\n', b'\n')
    new_lf = new.replace(b'\r\n', b'\n')
    if old_lf in c:
        c = c.replace(old_lf, new_lf, 1)
        print("Replaced LF - part 1")
    else:
        print("NO MATCH part 1")

# Now replace fetchEmiReminders() call with conditional
old2 = b'    fetchEmiReminders(),\r\n    fetchMaterialRequestReminders(),'
new2 = b'    hasFinanceAccess ? fetchEmiReminders() : Promise.resolve([]),\r\n    fetchMaterialRequestReminders(),'

if old2 in c:
    c = c.replace(old2, new2, 1)
    print("Replaced CRLF - part 2")
else:
    old2_lf = old2.replace(b'\r\n', b'\n')
    new2_lf = new2.replace(b'\r\n', b'\n')
    if old2_lf in c:
        c = c.replace(old2_lf, new2_lf, 1)
        print("Replaced LF - part 2")
    else:
        print("NO MATCH part 2")
        idx = c.find(b'fetchEmiReminders()')
        print(repr(c[idx-10:idx+60]))

with open('src/hooks/useReminders.ts', 'wb') as f:
    f.write(c)