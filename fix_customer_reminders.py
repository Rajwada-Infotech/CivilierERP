with open('src/hooks/useReminders.ts', 'rb') as f:
    c = f.read()

old = b'export async function fetchCustomerReminders(): Promise<ReminderItem[]> {\r\n  // Customer-scoped: only their own EMI installments\r\n  return fetchEmiReminders();\r\n}'
new = b'export async function fetchCustomerReminders(): Promise<ReminderItem[]> {\r\n  // /api/expense-booking is restricted to internal roles.\r\n  // Return empty until a customer-scoped endpoint exists.\r\n  return [];\r\n}'

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
        idx = c.find(b'fetchCustomerReminders')
        print(repr(c[idx:idx+120]))

with open('src/hooks/useReminders.ts', 'wb') as f:
    f.write(c)