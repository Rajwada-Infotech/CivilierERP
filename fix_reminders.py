with open('src/hooks/useReminders.ts', 'rb') as f:
    c = f.read()

old = b'      isFetching.current = true;\r\n      if (isManual) setLoading(true);\r\n\r\n      try {\r\n        const items = await fetchAllReminders(role);'
new = b'      if (!role || role === "customer") {\r\n        isFetching.current = false;\r\n        return;\r\n      }\r\n      isFetching.current = true;\r\n      if (isManual) setLoading(true);\r\n\r\n      try {\r\n        const items = await fetchAllReminders(role);'

if old in c:
    c = c.replace(old, new, 1)
    print('Replaced')
else:
    print('NO MATCH')

with open('src/hooks/useReminders.ts', 'wb') as f:
    f.write(c)