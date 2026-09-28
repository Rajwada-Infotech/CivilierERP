import sys

with open('backend/routes/crmApplications.js', 'r', encoding='utf-8') as f:
    code = f.read()

target = 'a.ProjectId, a.PreferredUnitId, a.CompanyId,'
insertion = '''a.ProjectId, a.PreferredUnitId, a.CompanyId,
    (SELECT STRING_AGG(CAST(UnitId AS NVARCHAR(10)), ',') FROM dbo.CrmApplicationUnit au WHERE au.ApplicationId = a.Id AND au.Status = 'Active') AS PreferredUnitIdsCsv,'''

code = code.replace(target, insertion)

with open('backend/routes/crmApplications.js', 'w', encoding='utf-8') as f:
    f.write(code)
