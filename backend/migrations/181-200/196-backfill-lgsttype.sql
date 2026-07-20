-- Step 1: Normalize Regular / Composition / etc. → Registered
UPDATE dbo.AccountHeadMaster
SET LGSTType = 'Registered'
WHERE LGSTType NOT IN ('Registered', 'Unregistered')
  AND LGSTType IS NOT NULL;

-- Step 2: Backfill NULLs
UPDATE dbo.AccountHeadMaster
SET LGSTType = CASE
    WHEN ISNULL(LGST, '') <> '' THEN 'Registered'
    ELSE 'Unregistered'
END
WHERE LGSTType IS NULL;



SELECT LGSTType, COUNT(*) as cnt
FROM dbo.AccountHeadMaster
GROUP BY LGSTType;
