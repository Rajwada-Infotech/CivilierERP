with open('src/pages/Home.tsx', 'rb') as f:
    c = f.read()

old = b'queryFn: () => fetchHomeDashboard(isAdmin),'
new = b'queryFn: () => fetchHomeDashboard(isAdmin, role),'

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
        print(repr(c[idx:idx+60]))

with open('src/pages/Home.tsx', 'wb') as f:
    f.write(c)