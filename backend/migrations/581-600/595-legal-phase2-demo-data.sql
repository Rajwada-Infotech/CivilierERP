-- 595 · Legal module Phase 2 sample data (Rajarhat land, LND-…-00001 "Rajarhat Chowmatha plot"):
--   previous owner Subhash Ghosh (1962–2014), his death and inheritance by sons Anirban (60%) and Suman (40%),
--   the ownership records and their verification checks, and documents with versions (one rejected, then re-uploaded).
-- Sample PDFs are stamped "SAMPLE - FOR TESTING ONLY". Added only if not there yet; safe to run again.
SET NOCOUNT ON;
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Death-Certificate-Subhash-Ghosh.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Death-Certificate-Subhash-Ghosh.pdf', N'application/pdf', 1058, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggMzg3IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nHWSS2+jMBSF9/0VZ9lKDbEtQskyk9BoJAJR4lnM8hZMcMVjZJP+/ppXW2mELFsIn/udo+vLvICDedx3h+AwNzCETGCz3cBnMArFwy+J9asADyAL8GE5nbsN+QYyx+Nef+hKKxNdzlghVjeqULf5vVJPkO+I5APzwk3vMGxXPCN5j3Skl5ANpOvudI4jHNL9n1OUSEd7TS+Q0VX+To5Ik/iv+5WkEjvE0XEXfym/jNCvHw7h7OCPWQ+KuhKZMp0udEadckBL9b/vrP9l42O2hGqFtkCuMkVW5ZN+dOKTXvDvguv9rSRb4li2tlyiB2E45uqjDHSXbxE9qwVbcbESjPuL3CAYlOeKMrXMm1QXeidTUveMpDWuP8LHmcyNGrKLBr4/lqqbtp2hTrcNmtZb9poKDtEpXR/26z79mm25mB3clPRDMu75CTm2k6E/dvWoGuXcVA6yrlt1i5w6QtEa/JhDD7uqQuOezIKaHM29flPGffcTrbNOu7h3O4f9BL1cyIEKZW5kc3RyZWFtIGVuZG9iago1IDAgb2JqIDw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PiBlbmRvYmoKNiAwIG9iaiA8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EtQm9sZCA+PiBlbmRvYmoKeHJlZgowIDcKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjUxIDAwMDAwIG4gCjAwMDAwMDA3MTAgMDAwMDAgbiAKMDAwMDAwMDc4MCAwMDAwMCBuIAp0cmFpbGVyIDw8IC9TaXplIDcgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjg1NQolJUVPRgo=', (SELECT MIN(id) FROM dbo.users));
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Legal-Heir-Certificate-Ghosh.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Legal-Heir-Certificate-Ghosh.pdf', N'application/pdf', 1043, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggMzcyIC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nI2SS2uDQBSF9/kVZ5ksah0x1ixtYmzAPIjTRSGbSRzjFB9lRgv99x1fSaAIZbgieu53DneuaTgEpkFs/bAI5BUmXNPCfDGHbUJyJJNXiue1BeKAJiDt0Tr91yVz0BjTpfgWmeDSPx7whJBfWYa8jOuMz0A/4dOJabjzxqEt3TwgSYPUpBfXbEmRtz2EPlb75fvW31FNW++PoH5EN7sA+134oT/t9hQeQj/wwpvyZoTmPDi4g4PdZe3SpVxIXLisRCIurOKaqlj+dQ/8JyDpAq74hTPF417X2ZBeZ5G7MKrPKVMpgrRU6RjVcd1W/NbEIaPMQeYVQp5Z0TFxmqqyOM1G2Y5zZ1vj7F4W1fm/ybbdtmyUqnmM8884vFdG7Wz1kIuyghjawApddZWWUlQDZKJ3pVmVroaLJFj05nY33oAXXOqLi8EUYp6XiFnFkJQSD9towMsyFCznSpvFKOr8zKV+b/ZaXCpRibJWRm/9C+YwzhwKZW5kc3RyZWFtIGVuZG9iago1IDAgb2JqIDw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PiBlbmRvYmoKNiAwIG9iaiA8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EtQm9sZCA+PiBlbmRvYmoKeHJlZgowIDcKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjUxIDAwMDAwIG4gCjAwMDAwMDA2OTUgMDAwMDAgbiAKMDAwMDAwMDc2NSAwMDAwMCBuIAp0cmFpbGVyIDw8IC9TaXplIDcgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjg0MAolJUVPRgo=', (SELECT MIN(id) FROM dbo.users));
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Mutation-Record-Rajarhat.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Mutation-Record-Rajarhat.pdf', N'application/pdf', 1050, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggMzc5IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nHWSSW+DMBCF7/kV79hIDbERUHqkLUkXCFHiHCrlMg1OQsRSGeihv75m66IKWcYC3nzvMQwzHA5mcEtfTA51AoPLTNi3NiwGJXGc3AnMFya4A3EEb5fW6bcutyFiXN0nH0maSOVv1pghkCdKkRVxncopxAW+mDDDtRuHduviAckbpCbduKwlbb1wHfh4iO53ob8SmraINhD+VjytlohWwat+tIoEPAT+0gu+ld9GaNYvB3dwsLqsYV1RlRS5/rRDoWKNKyl7/0n6LxnvkoVF/Um9qIPzXmTyH9WGLqTOVGF/9WwEBjiz99MxtOO6bVGwwYuuSSgf5Q9Sk9kcc+jDHKU6Tit9LNJYqnIc2eu8PFFvlGN5LsrzNbZ1NtyMOljW31YeqJTjPr36wQ+jWbgTM5Nxe8b5zYDXw9HMRreHP8dx27tZXWeXMpeKKhmDSsQyKxBTRTgWCr/Gz4CXpsgpkyUoj5HX2ZtuAqgZ5ORQJTpvXRq99RdTt8Q2CmVuZHN0cmVhbSBlbmRvYmoKNSAwIG9iaiA8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4gZW5kb2JqCjYgMCBvYmogPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgPj4gZW5kb2JqCnhyZWYKMCA3CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI1MSAwMDAwMCBuIAowMDAwMDAwNzAyIDAwMDAwIG4gCjAwMDAwMDA3NzIgMDAwMDAgbiAKdHJhaWxlciA8PCAvU2l6ZSA3IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo4NDcKJSVFT0YK', (SELECT MIN(id) FROM dbo.users));
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Previous-Deed-1962-Subhash.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Previous-Deed-1962-Subhash.pdf', N'application/pdf', 1039, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggMzY4IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nH2SzY6CMBSF9/MUZ6kLsSXA4JJRNE4QjXYWk7ipUgUDMingYp5+Wn7UZIJpSgic+52Tey8xHApiUEs9TAp5BoFLTNgTGxaBFDi9fTCM5yaoA3YCrY/Sqb8utcEiDKbJLUkTIf3tBiME4sxTZHlUpWIIdoHP3ojh2tqhvqq4Q1KNVKR3l9SknbfaBD5m6+nXyg+Zos3XWzB/x5bhAusw+FafwjWDh8BfeMFdeTeCPk8ObudgNVk3UtySvCoQCRFhP6ATx9wPFbXg2c8j8L+AtAk401XXKjsI2UobJ9pKTfrQLkfEoibG0B59YMd1m1yVPMa8eIHtlLvqoIQxFnFexL1Yx6nFq7z65f3IVrXlFy5jXqp+fBqBAUrs/bAXbVl1kSfFC3IroqZhq1Yfk4ynHVBtg16G5najopi0fKvp3kJcheSlajfXw8pyRLzkOOUST/tmwEtTXHkmCvBrNxr1rjc3OZZJqYdttNZ/xmO/DwplbmRzdHJlYW0gZW5kb2JqCjUgMCBvYmogPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+IGVuZG9iago2IDAgb2JqIDw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYS1Cb2xkID4+IGVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNTEgMDAwMDAgbiAKMDAwMDAwMDY5MSAwMDAwMCBuIAowMDAwMDAwNzYxIDAwMDAwIG4gCnRyYWlsZXIgPDwgL1NpemUgNyAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKODM2CiUlRU9GCg==', (SELECT MIN(id) FROM dbo.users));
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Seller-ID-Anirban-v1-blurred.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Seller-ID-Anirban-v1-blurred.pdf', N'application/pdf', 1035, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggMzY0IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nHWSQW+CMBzF736Kd9SDjBJgeGQO2TJEo91hiZcqVWugNQVN9u1XQNRkIU05lMfvPd6/tuUT2BZxzcMh0AfYCGwH3sSDa0Nz7AdvFC8zB8QH3YM0y+jM24B4oBmGU3EVueA6Wi0xRsIPLEehskvOR6AnRHRgW4FXOzTbfNwhSY00pNfAbkjrcL5MIrwvpt/zKKWGNlusQKM1/UxjLNLkxxylC4oQSRSHyV15N0K9nhyCzsFts655nnMNkXFZieoXZ63U3kBLVpxzjs3wSjajjvYvJmljpqzofq01IjeNQx6iUAq9ZRLxUZXHPqIfBI14Gaa9wE4Txh/L2PUc8tVL8/02n6r683WimdBlhXJnIo5xkZqzjG2bCm5d7JUGM1fgxHcVz3DluhRKPtoxU62H2u6ucoLJLYzb1hBzyTWrAaxExguFjFWsgT/dGwthnkOaXkswmUFeiq3xA6tvoNiZUQl1Ka2b9R+6yLdNCmVuZHN0cmVhbSBlbmRvYmoKNSAwIG9iaiA8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4gZW5kb2JqCjYgMCBvYmogPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgPj4gZW5kb2JqCnhyZWYKMCA3CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI1MSAwMDAwMCBuIAowMDAwMDAwNjg3IDAwMDAwIG4gCjAwMDAwMDA3NTcgMDAwMDAgbiAKdHJhaWxlciA8PCAvU2l6ZSA3IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo4MzIKJSVFT0YK', (SELECT MIN(id) FROM dbo.users));
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Seller-ID-Anirban-v2.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Seller-ID-Anirban-v2.pdf', N'application/pdf', 1013, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggMzQyIC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nHWSwW+CMBjF7/4V76gHGSXA8MgcsmUIRLvDEi9VirKUYgqa7L9fAXEmC2naEPr6e6/fV9NwCUyD2HqxCNQRJjzTgrNwYJtQHPnkheJpZYG4oDlIN7RO73rEAc0wXRbXQhRcBZsUc0T8yATKKrsIPgP9RkAnpuE5rUM39eEBSVqkJj17Zkfa+us0CvCaLD/XQUw1bZVsQIMtfY9DJHH0pX/FCYWPKAj96K68G6EdDw7e4GD3WbdcCK5QZFw2RfODs6qqXENrVp4Fx256tXazgfYvJuljxqwcrtYbkZvGIn8iXxZqzyTCU1Wfxoiu53Xi1I9HgYPGD9/S0HYs8jFKc90+X9WM5xtES8GZ0h2e1wcmB6LuVNuofg5lJFjcDOz+aiGXXLGGZ2A1Ml5WyFjDkFcKD2/BgC8EpK5VDSYzyEu550p/t6+qOOjyF9WlNm7Wv0b9p5IKZW5kc3RyZWFtIGVuZG9iago1IDAgb2JqIDw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PiBlbmRvYmoKNiAwIG9iaiA8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EtQm9sZCA+PiBlbmRvYmoKeHJlZgowIDcKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjUxIDAwMDAwIG4gCjAwMDAwMDA2NjUgMDAwMDAgbiAKMDAwMDAwMDczNSAwMDAwMCBuIAp0cmFpbGVyIDw8IC9TaXplIDcgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjgxMAolJUVPRgo=', (SELECT MIN(id) FROM dbo.users));
GO
DECLARE @u INT = (SELECT MIN(id) FROM dbo.users);
DECLARE @land INT = (SELECT TOP 1 LandId FROM dbo.LegalLand WHERE Remarks LIKE N'(Demo) Converted%');
DECLARE @f TABLE (n NVARCHAR(200), id INT);
INSERT INTO @f SELECT FileName, FileId FROM dbo.LegalMasterFile WHERE FileName LIKE N'SAMPLE-%';
DECLARE @lk TABLE (c NVARCHAR(40), n NVARCHAR(150), id INT);
INSERT INTO @lk SELECT Category, Name, LookupId FROM dbo.LegalLookupValue;

IF @land IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalOwnershipEvent WHERE LandId = @land)
BEGIN
  -- The previous owner.
  IF NOT EXISTS (SELECT 1 FROM dbo.LegalPerson WHERE PersonRole = N'Owner' AND FullName = N'Subhash Ghosh')
    INSERT INTO dbo.LegalPerson (PersonRole, PartyType, FullName, GuardianName, DateOfBirth, Gender, Address, Remarks, CreatedBy)
    VALUES (N'Owner', N'Individual', N'Subhash Ghosh', N'Late Haripada Ghosh', '1935-02-10', N'Male', N'12 Rajarhat Main Road, Kolkata 700135', N'(Demo) Deceased previous owner', @u);

  DECLARE @sub INT = (SELECT PersonId FROM dbo.LegalPerson WHERE PersonRole = N'Owner' AND FullName = N'Subhash Ghosh');
  DECLARE @ani INT = (SELECT PersonId FROM dbo.LegalPerson WHERE PersonRole = N'Owner' AND FullName = N'Anirban Ghosh');
  DECLARE @sum INT = (SELECT PersonId FROM dbo.LegalPerson WHERE PersonRole = N'Owner' AND FullName = N'Suman Ghosh');
  DECLARE @dec INT = (SELECT AreaUnitId FROM dbo.LegalAreaUnit WHERE UnitCode = N'DEC');
  DECLARE @sale INT = (SELECT id FROM @lk WHERE c = N'transfer-type' AND n = N'Sale');
  DECLARE @inh INT = (SELECT id FROM @lk WHERE c = N'transfer-type' AND n = N'Inheritance');
  DECLARE @son INT = (SELECT id FROM @lk WHERE c = N'relationship-type' AND n = N'Son');

  -- Transfer history: bought in 1962, inherited by the two sons in 2015.
  INSERT INTO dbo.LegalOwnershipEvent (LandId, TransferTypeId, EventDate, PreviousOwnerId, NewOwnerId, DeedNo, TransferArea, AreaUnitId, TransferSharePct, TransferValue, DocFileId, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
  VALUES
    (@land, @sale, '1962-03-01', NULL, @sub, N'I-0412/1962', 12.5, @dec, 100, 4500, (SELECT id FROM @f WHERE n = N'SAMPLE-Previous-Deed-1962-Subhash.pdf'), N'Verified', @u, SYSUTCDATETIME(), N'(Demo) Original purchase', @u),
    (@land, @inh, '2015-01-01', @sub, @ani, NULL, 7.5, @dec, 60, NULL, (SELECT id FROM @f WHERE n = N'SAMPLE-Legal-Heir-Certificate-Ghosh.pdf'), N'Verified', @u, SYSUTCDATETIME(), N'(Demo) Inherited on father''s death', @u),
    (@land, @inh, '2015-01-01', @sub, @sum, NULL, 5.0, @dec, 40, NULL, (SELECT id FROM @f WHERE n = N'SAMPLE-Legal-Heir-Certificate-Ghosh.pdf'), N'Pending', NULL, NULL, N'(Demo) Awaiting mutation record check', @u);

  -- Ownership periods.
  INSERT INTO dbo.LegalOwnershipRecord (LandId, PersonId, OwnershipTypeId, RelationshipTypeId, SharePct, ValidFrom, ValidTo, EventId, PreviousPersonId, TransferDocFileId, VerificationStatus, VerifiedBy, VerifiedAt, VerificationRemarks, CreatedBy)
  SELECT @land, v.p, (SELECT id FROM @lk WHERE c = N'ownership-type' AND n = v.ot), v.rel, v.sh, v.vf, v.vt,
         (SELECT TOP 1 EventId FROM dbo.LegalOwnershipEvent e WHERE e.LandId = @land AND e.NewOwnerId = v.p),
         v.prev, (SELECT id FROM @f WHERE n = v.doc), v.vs, CASE WHEN v.vs = N'Verified' THEN @u END, CASE WHEN v.vs = N'Verified' THEN SYSUTCDATETIME() END, v.rem, @u
  FROM (VALUES
    (@sub, N'Individual', NULL, 100.0, CAST('1962-03-01' AS DATE), CAST('2014-12-20' AS DATE), NULL, N'SAMPLE-Previous-Deed-1962-Subhash.pdf', N'Verified', N'(Demo) Sole owner till death'),
    (@ani, N'Inherited', @son, 60.0, CAST('2015-01-01' AS DATE), NULL, @sub, N'SAMPLE-Legal-Heir-Certificate-Ghosh.pdf', N'Verified', N'(Demo) Matches LR Khatian 2051'),
    (@sum, N'Inherited', @son, 40.0, CAST('2015-01-01' AS DATE), NULL, @sub, N'SAMPLE-Legal-Heir-Certificate-Ghosh.pdf', N'Pending', N'(Demo) LR copy awaited')
  ) v (p, ot, rel, sh, vf, vt, prev, doc, vs, rem)
  WHERE v.p IS NOT NULL;

  -- Inheritance with the two heirs.
  INSERT INTO dbo.LegalInheritance (LandId, DeceasedPersonId, DateOfDeath, DeathCertFileId, HeirCertFileId, SupportingType, MutationRecordNo, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
  VALUES (@land, @sub, '2014-12-20', (SELECT id FROM @f WHERE n = N'SAMPLE-Death-Certificate-Subhash-Ghosh.pdf'), (SELECT id FROM @f WHERE n = N'SAMPLE-Legal-Heir-Certificate-Ghosh.pdf'),
          N'None', N'DEMO-MUT-2015-117', N'Verified', @u, SYSUTCDATETIME(), N'(Demo) Death and heir certificates checked', @u);
  INSERT INTO dbo.LegalInheritanceHeir (LandId, InheritanceId, PersonId, RelationshipTypeId, SharePct, Remarks, CreatedBy)
  SELECT @land, i.InheritanceId, v.p, @son, v.sh, N'(Demo)', @u
  FROM dbo.LegalInheritance i CROSS JOIN (VALUES (@ani, 60.0), (@sum, 40.0)) v (p, sh)
  WHERE i.LandId = @land;

  -- Checks: Anirban's record fully reviewed; Suman's partly (one needs correction).
  INSERT INTO dbo.LegalOwnershipCheck (LandId, RecordId, CheckItem, Result, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
  SELECT @land, r.RecordId, c.item,
         CASE WHEN r.PersonId = @ani THEN CASE WHEN c.item = N'Relationship document checked' THEN N'Verified' ELSE N'Verified' END
              WHEN c.item = N'Transfer document checked' THEN N'Needs Correction'
              WHEN c.item IN (N'Identity document checked', N'Relationship document checked') THEN N'Verified' ELSE N'Pending' END,
         @u, SYSUTCDATETIME(),
         CASE WHEN r.PersonId = @sum AND c.item = N'Transfer document checked' THEN N'(Demo) Heir certificate copy is not attested' ELSE N'(Demo)' END, @u
  FROM dbo.LegalOwnershipRecord r
  CROSS JOIN (VALUES (N'Identity document checked'), (N'Previous ownership document checked'), (N'Transfer document checked'), (N'Relationship document checked'),
                     (N'Ownership share checked'), (N'Date continuity checked'), (N'Current ownership checked')) c (item)
  WHERE r.LandId = @land AND r.PersonId IN (@ani, @sum);
  UPDATE dbo.LegalOwnershipCheck SET VerifiedBy = NULL, VerifiedAt = NULL WHERE LandId = @land AND Result = N'Pending';

  -- Step 5 is now in progress.
  IF NOT EXISTS (SELECT 1 FROM dbo.LegalWorkflowStepState WHERE LandId = @land AND StepCode = N'OWNERSHIP')
  BEGIN
    INSERT INTO dbo.LegalWorkflowStepState (LandId, StepCode, Status, ResponsibleUserId, Remarks, UpdatedBy)
    VALUES (@land, N'OWNERSHIP', N'In Progress', @u, N'(Demo) Suman''s transfer document needs an attested copy', @u);
    INSERT INTO dbo.LegalWorkflowStepHistory (LandId, StepCode, PreviousStatus, NewStatus, Remarks, ChangedBy)
    VALUES (@land, N'OWNERSHIP', NULL, N'In Progress', N'(Demo) sample data', @u);
  END;
END;
GO

-- ── Documents (step 6) for the same land ──
DECLARE @u INT = (SELECT MIN(id) FROM dbo.users);
DECLARE @land INT = (SELECT TOP 1 LandId FROM dbo.LegalLand WHERE Remarks LIKE N'(Demo) Converted%');
DECLARE @yr NVARCHAR(4) = CAST(YEAR(SYSDATETIME()) AS NVARCHAR(4));

IF @land IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalLandDocument WHERE LandId = @land)
BEGIN
  UPDATE dbo.LegalLand SET ChecklistTemplateId = (SELECT TOP 1 TemplateId FROM dbo.LegalChecklistTemplate WHERE IsActive = 1 ORDER BY TemplateId)
  WHERE LandId = @land AND ChecklistTemplateId IS NULL;

  DECLARE @base INT = ISNULL((SELECT MAX(TRY_CAST(RIGHT(DocumentCode, 5) AS INT)) FROM dbo.LegalLandDocument WHERE DocumentCode LIKE N'DOC-' + @yr + N'-%'), 0);
  DECLARE @docs TABLE (i INT, code NVARCHAR(20), section NVARCHAR(30), title NVARCHAR(200), no NVARCHAR(100), dt DATE, auth NVARCHAR(200));
  INSERT INTO @docs VALUES
    (1, N'PARENT-DEED', N'Ownership', N'Previous deed I-0412 / 1962', N'I-0412/1962', '1962-03-01', N'Sub-Registrar, Barasat'),
    (2, N'ROR', N'Property', N'LR Record of Rights - Khatian 2051', N'2051', '2025-11-12', N'BL&LRO Rajarhat'),
    (3, N'MUTATION', N'Ownership', N'Mutation record 2015', N'DEMO-MUT-2015-117', '2015-06-30', N'BL&LRO Rajarhat'),
    (4, N'SELLER-ID', N'Ownership', N'Seller identity proof - Anirban Ghosh', N'AGHPG4521K', NULL, N'Income Tax Department');

  INSERT INTO dbo.LegalLandDocument (DocumentCode, LandId, DocTypeId, RelatedSection, Title, DocumentNo, DocumentDate, IssuingAuthority, CurrentVersionNo, Remarks, CreatedBy)
  SELECT N'DOC-' + @yr + N'-' + RIGHT('00000' + CAST(@base + d.i AS VARCHAR(5)), 5), @land, t.DocTypeId, d.section, d.title, d.no, d.dt, d.auth,
         CASE WHEN d.i = 4 THEN 2 ELSE 1 END, N'(Demo)', @u
  FROM @docs d JOIN dbo.LegalDocumentType t ON t.DocTypeCode = d.code;

  INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, UploadRemarks, UploadedBy, ReviewStatus, ReviewedBy, ReviewedAt, ReviewRemarks)
  SELECT doc.DocumentId, v.vno, f.FileId, v.up, @u, v.rs, CASE WHEN v.rs <> N'Pending' THEN @u END, CASE WHEN v.rs <> N'Pending' THEN SYSUTCDATETIME() END, v.rr
  FROM (VALUES
    (N'Previous deed I-0412 / 1962', 1, N'SAMPLE-Previous-Deed-1962-Subhash.pdf', NULL, N'Verified', N'(Demo) Matches registry search'),
    (N'LR Record of Rights - Khatian 2051', 1, N'SAMPLE-LR-Kh2051-Dag1871.pdf', NULL, N'Verified', N'(Demo)'),
    (N'Mutation record 2015', 1, N'SAMPLE-Mutation-Record-Rajarhat.pdf', NULL, N'Pending', NULL),
    (N'Seller identity proof - Anirban Ghosh', 1, N'SAMPLE-Seller-ID-Anirban-v1-blurred.pdf', NULL, N'Rejected', N'(Demo) Scan is unreadable - please re-upload'),
    (N'Seller identity proof - Anirban Ghosh', 2, N'SAMPLE-Seller-ID-Anirban-v2.pdf', N'(Demo) Clear re-scan', N'Pending', NULL)
  ) v (title, vno, fname, up, rs, rr)
  JOIN dbo.LegalLandDocument doc ON doc.LandId = @land AND doc.Title = v.title
  JOIN dbo.LegalMasterFile f ON f.FileName = v.fname;

  INSERT INTO dbo.LegalRecordAudit (UserId, Action, EntityType, EntityId, LandId, Remarks)
  SELECT @u, N'Document uploaded', N'Land Document', DocumentId, @land, N'(Demo) sample data' FROM dbo.LegalLandDocument WHERE LandId = @land;
END;
GO

PRINT '595-legal-phase2-demo-data applied successfully.';
GO
