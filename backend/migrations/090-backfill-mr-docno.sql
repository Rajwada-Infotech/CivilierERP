-- Migration 090: Backfill DocNo on MaterialRequests rows that were saved
-- before the DocNo stamp fix (migration 089 era).
--
-- Strategy: join MaterialRequests with DocNumberSequence on (TableName, RecordId)
-- and copy the DocNo across where it's currently NULL.

UPDATE mr
SET    mr.DocNo = dns.DocNo,
       mr.UpdatedAt = GETDATE()
FROM   dbo.MaterialRequests mr
JOIN   dbo.DocNumberSequence dns
       ON  dns.TableName = 'MaterialRequests'
       AND dns.RecordId  = mr.MRId
WHERE  mr.DocNo IS NULL
  AND  dns.DocNo IS NOT NULL;

-- Report how many rows were updated (informational)
SELECT @@ROWCOUNT AS RowsBackfilled;
