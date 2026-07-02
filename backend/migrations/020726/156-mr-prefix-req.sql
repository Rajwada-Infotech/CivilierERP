-- Change Material Request doc number prefix from MR to REQ
UPDATE dbo.TypeOfDoc
SET    DocNoPrefix = 'REQ',
       Prefix      = 'REQ'
WHERE  DocNoPrefix = 'MR'
  AND  IsActive    = 1;
