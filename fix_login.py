with open('src/pages/Login.tsx', 'rb') as f:
    c = f.read()

old = b'          const role = result.role;\r\n          if (role === "dba") navigate("/dba", { replace: true });\r\n          else if (role === "super_admin" || role === "admin")\r\n            navigate("/admin/dashboard", { replace: true });\r\n          else navigate("/home", { replace: true });'

new = b'          const role = result.role;\r\n          const uid = result.userId ?? "";\r\n          if (role === "customer") navigate(`/customer-portal/${uid}`, { replace: true });\r\n          else if (role === "dba") navigate(`/dba/${uid}`, { replace: true });\r\n          else if (role === "super_admin" || role === "admin")\r\n            navigate(`/admin/dashboard/${uid}`, { replace: true });\r\n          else navigate(`/home/${uid}`, { replace: true });'

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

with open('src/pages/Login.tsx', 'wb') as f:
    f.write(c)