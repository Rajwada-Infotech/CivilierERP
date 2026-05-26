with open('src/hooks/useReminders.ts', 'rb') as f:
    c = f.read()

old = b'useEffect(() => {\r\n    let cancelled = false;\r\n\r\n    refresh();'
new = b'useEffect(() => {\r\n    if (!role) return;\r\n    let cancelled = false;\r\n\r\n    refresh();'

if old in c:
    c = c.replace(old, new, 1)
    print("Replaced")
else:
    print("NO MATCH")

with open('src/hooks/useReminders.ts', 'wb') as f:
    f.write(c)