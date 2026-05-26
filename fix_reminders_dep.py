with open('src/hooks/useReminders.ts', 'rb') as f:
    c = f.read()

# The useEffect has empty dep array - need to add role to it
old = b'    // eslint-disable-next-line react-hooks/exhaustive-deps\r\n  }, []);'
new = b'    // eslint-disable-next-line react-hooks/exhaustive-deps\r\n  }, [role]);'

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
        print("NO MATCH - checking exact bytes")
        idx = c.find(b'eslint-disable-next-line react-hooks/exhaustive-deps')
        print(repr(c[idx:idx+60]))

with open('src/hooks/useReminders.ts', 'wb') as f:
    f.write(c)