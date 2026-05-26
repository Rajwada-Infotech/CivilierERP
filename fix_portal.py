with open('src/pages/customer/CustomerPortal.tsx', 'rb') as f:
    c = f.read()

# Remove the progress tab from tabs array
old = b'  const tabs = [\r\n    { id: "tickets"   as Tab, label: "My Tickets",      icon: <Ticket size={14} /> },\r\n    { id: "progress"  as Tab, label: "Project Progress", icon: <HardHat size={14} /> },\r\n    { id: "reminders" as Tab, label: "Reminders",        icon: <Bell size={14} /> },\r\n  ];'
new = b'  const tabs = [\r\n    { id: "tickets"   as Tab, label: "My Tickets",      icon: <Ticket size={14} /> },\r\n    { id: "reminders" as Tab, label: "Reminders",        icon: <Bell size={14} /> },\r\n  ];'

if old in c:
    c = c.replace(old, new, 1)
    print("Removed progress tab")
else:
    print("NO MATCH - checking LF")
    old_lf = old.replace(b'\r\n', b'\n')
    new_lf = new.replace(b'\r\n', b'\n')
    if old_lf in c:
        c = c.replace(old_lf, new_lf, 1)
        print("Removed progress tab (LF)")
    else:
        print("STILL NO MATCH")

with open('src/pages/customer/CustomerPortal.tsx', 'wb') as f:
    f.write(c)