import sys

with open('backend/routes/crmApplications.js', 'r', encoding='utf-8') as f:
    code = f.read()

target = 'const b = req.body;'
insertion = '''const b = req.body;
    // Map PreferredUnitIds array (from updated CrmApplication.tsx) back to PreferredUnitId for the primary unit logic
    if (b.PreferredUnitIds !== undefined) {
      b.PreferredUnitId = Array.isArray(b.PreferredUnitIds) && b.PreferredUnitIds.length > 0 ? b.PreferredUnitIds[0] : null;
    }'''

code = code.replace(target, insertion)

# Find the end of the UPDATE dbo.CrmApplication query execution
# It looks like:
# .query(
#   UPDATE dbo.CrmApplication SET
# ...
# );
# We need to insert the CrmApplicationUnit update after it.

insert_unit_lines = '''
    // Update CrmApplicationUnit lines if PreferredUnitIds was provided
    if (b.PreferredUnitIds !== undefined) {
      const rawIds = Array.isArray(b.PreferredUnitIds) ? b.PreferredUnitIds : [];
      await pool.request().input("aid", sql.Int, id).query("DELETE FROM dbo.CrmApplicationUnit WHERE ApplicationId = @aid");
      if (rawIds.length > 0) {
        for (const uidStr of rawIds) {
          await pool.request()
            .input("aid", sql.Int, id)
            .input("uid", sql.Int, parseInt(uidStr))
            .input("pri", sql.Bit, String(uidStr) === String(b.PreferredUnitId) ? 1 : 0)
            .query("INSERT INTO dbo.CrmApplicationUnit (ApplicationId, UnitId, Status, IsPrimary, CreatedAt) VALUES (@aid, @uid, 'Active', @pri, SYSDATETIME())");
        }
      }
    }
'''

# Find the update query block
# The exact end of it is .query(... UPDATE dbo.CrmApplication SET ... );
# Let's search for .query(\n          UPDATE dbo.CrmApplication SET
update_start = code.find('UPDATE dbo.CrmApplication SET')
if update_start != -1:
    update_end = code.find(');', update_start)
    if update_end != -1:
        code = code[:update_end+2] + insert_unit_lines + code[update_end+2:]

with open('backend/routes/crmApplications.js', 'w', encoding='utf-8') as f:
    f.write(code)
