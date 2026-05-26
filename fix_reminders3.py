with open('src/hooks/useReminders.ts', 'rb') as f:
    c = f.read()

old = b'      if (!role || role === "customer") {\r\n        isFetching.current = false;\r\n        return;\r\n      }'
new = b'      if (!role) {\r\n        isFetching.current = false;\r\n        return;\r\n      }'

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
        idx = c.find(b'isFetching.current = false')
        print(repr(c[idx-30:idx+60]))

with open('src/hooks/useReminders.ts', 'wb') as f:
    f.write(c)