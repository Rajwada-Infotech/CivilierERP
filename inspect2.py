with open('src/hooks/useReminders.ts', 'rb') as f:
    c = f.read()
idx = c.find(b'useEffect(() => {')
print(repr(c[idx:idx+100]))