with open('src/hooks/useReminders.ts', 'rb') as f:
    c = f.read()

idx = c.find(b'isFetching.current = true')
print(repr(c[idx-10:idx+120]))