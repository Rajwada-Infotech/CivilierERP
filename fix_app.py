import sys

with open('backend/services/crmEntityCreation.js', 'r', encoding='utf-8') as f:
    code = f.read()

targetFunctionStart = code.find('async function createCrmApplicationRecord')
targetFunctionEnd = code.find('async function updateCrmApplicationRecord', targetFunctionStart)

funcCode = code[targetFunctionStart:targetFunctionEnd]

funcCode = funcCode.replace('let unitName = b.InterestedUnit || null;', '''const rawAppUnitIds = Array.isArray(b.PreferredUnitIds) && b.PreferredUnitIds.length > 0 ? b.PreferredUnitIds : (b.PreferredUnitId ? [b.PreferredUnitId] : []);
  const preferredUnitId = rawAppUnitIds.length > 0 ? rawAppUnitIds[0] : null;
  let unitName = b.InterestedUnit || null;''')

funcCode = funcCode.replace('b.PreferredUnitId', 'preferredUnitId')
funcCode = funcCode.replace('preferredUnitIds', 'b.PreferredUnitIds')

funcCode = funcCode.replace('''if (preferredUnitId) {
    try {
      await placeHoldIfNeeded''', '''if (rawAppUnitIds.length > 0) {
    for (const uid of rawAppUnitIds) {
      await pool.request()
        .input('aid', sql.Int, applicationId)
        .input('uid', sql.Int, parseInt(uid))
        .input('pri', sql.Bit, uid === preferredUnitId ? 1 : 0)
        .query("INSERT INTO dbo.CrmApplicationUnit (ApplicationId, UnitId, Status, IsPrimary, CreatedAt) VALUES (@aid, @uid, 'Active', @pri, SYSDATETIME())");
    }
  }
  if (preferredUnitId) {
    try {
      await placeHoldIfNeeded''')

code = code[:targetFunctionStart] + funcCode + code[targetFunctionEnd:]

with open('backend/services/crmEntityCreation.js', 'w', encoding='utf-8') as f:
    f.write(code)
