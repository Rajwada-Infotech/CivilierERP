-- 600 · Legal module Phases 4 and 5 sample data, on the Rajarhat land:
--   purchase by Rajwada Infra (12.5 dec, Rs 95 lakh), verified valuation & survey, signed agreement, approvals
--   (Suman's signature pending), advance verified and a second instalment awaiting verification, expenses;
--   the sale deed with draft v1 (correction required) and v2 (under review, two checks pending), a verified fee
--   calculation, one fee payment verified and one pending, and the registration appointment.
-- Amounts and fees are sample figures. Sample PDFs are stamped "SAMPLE - FOR TESTING ONLY". Safe to run again.
SET NOCOUNT ON;
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Agreement-for-Sale-Rajarhat.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Agreement-for-Sale-Rajarhat.pdf', N'application/pdf', 1099, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggNDI4IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nHWTX2urMBjG7/cpnpvBBp1LRJ3lXLnVlYFri/VcHNjNuyZtLTGOqD3s2y/+2wpDYgTfPD6/1+SROQEHc7hnby6HOYAhZC78uQ+PwUjsrx4z3D+74AGyPXg3rM6uhtxHJnDzlJ9zlUsTpxvcIZEHUihK0Sh5i+yEOLtiTui3hG7al0dL3lpap4eQdU7b6HWTxFisn/6+xqvMuj2vU2TxNntZLbFeJf9sabXOECGJl1HyrfwGoR0XhHAkeH2v0cFIWUhdY18aVKSkdayo+Php9ldzvG/usfmUZhD1/nwQufxHldLpPwnCi94bwkKepSo/pKmwOddIajFFCcKw3wKplJVPckZdpHPzThrLY1kd8XYTsOu32xm2TXFR9NriJDEIOqeEtJjGDSLuOj6E3OUFqRnSLRZ0AHeZj3skaf8UPnC7RCcyR6onqZ7Xh6bUVS6koTov9TR+UKcV5v6MMXuxPyBxJr2TsFXOhurIs1lro9bPMQgc8wHv9ae0lLpFSwGq7GcVJQTV1GXiIs0OIqWgqZAV7CZBN8V7e5TU/hf5rs5t703lDOgv8MLcLQplbmRzdHJlYW0gZW5kb2JqCjUgMCBvYmogPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+IGVuZG9iago2IDAgb2JqIDw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYS1Cb2xkID4+IGVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNTEgMDAwMDAgbiAKMDAwMDAwMDc1MSAwMDAwMCBuIAowMDAwMDAwODIxIDAwMDAwIG4gCnRyYWlsZXIgPDwgL1NpemUgNyAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKODk2CiUlRU9GCg==', (SELECT MIN(id) FROM dbo.users));
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Valuation-Report-Rajarhat.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Valuation-Report-Rajarhat.pdf', N'application/pdf', 1054, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggMzgzIC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nIWSW2+CQBSE3/0V86iJpbsEKD5ai6YJaqPbJk18OZVVsVzMsti/3+XiJWlIs1lCYPhmODvM8jiYxR1zsTnUHgw+s+GOXDgMSmLXexZ4nNrgHsQOvF5GZ9763IWI0J/E5ziJpQpWb3hAKPeUIM2jMpEDiCMC0WOW71YO9TYfX5C8QhrSk89q0no8fwsDvCwn7/NgIQxtulxBBGvxuphhuQg/zaPFUmCMMJiNw6vyaoRq3Tn4FwenyfpBSUk6zjPzb6dcacMrKD3dov6JxptoIWVRq2ngvNXY/CZa0ZHUgTQmh/wnJX0gnJJcD8Fty0Ukt3FKSZeT5/s1ZE7qW2qcTVLZ6XgRrwqMnoYuGzLGOsGeV2tn+Vlb/3FbbcX1DbTiYtNvZoRdvC+V3Aw6nRznOmWpuk1a2bqhnu/VPVOWqivNvpwkx6i1cJpJz2QmFWkZgQoz2DRHRJqwyxXu6mhhnCTIKJUFzPkhK9Mvqcx9Vex4q2PThLKwWutf0lfMEAplbmRzdHJlYW0gZW5kb2JqCjUgMCBvYmogPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+IGVuZG9iago2IDAgb2JqIDw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYS1Cb2xkID4+IGVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNTEgMDAwMDAgbiAKMDAwMDAwMDcwNiAwMDAwMCBuIAowMDAwMDAwNzc2IDAwMDAwIG4gCnRyYWlsZXIgPDwgL1NpemUgNyAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKODUxCiUlRU9GCg==', (SELECT MIN(id) FROM dbo.users));
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Advance-Receipt-Rajarhat.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Advance-Receipt-Rajarhat.pdf', N'application/pdf', 1060, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggMzg5IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nHWSy26jMBiF932Ks6pmpAljI0LokmlIVIlAlHgWs3Ri01KBHZnLqG9fO0CbqkK+COPD+Q72T7yQgng0sJNPYZ5BEBEfy4clAgIjUdz9Yfi98UFDsAL02qzO7kZ0CSbw47Hsy6qUJjnssUAqn3mFWouukj/BXpGwO+JFS0e4DvvxZEmdpXVaReTqdIx3+zTBOn/8u0syZt02+QEsObKnbIs8S//ZV1nOECNNtnH6ofwAwbUbQjQRgiFrLHquztLmU/LN/t9ZlpfWmja8vnzm/ZaPDvkOTt9LgcLoehQPKDqKfXqj5q//ueB4UoXhWMteVvoiTYN93yJtxRwtjKIha6071c5iJtmhASW/iOtk1jIMr9qdFnLecBRlyYZhnezyhXtarFbUnzcOgq8nc3qb9x+1sSrNiStsX3Tzgnscu3paTRhbMa5ghjFdJ8XDSA2GA95KJQ1vLZU3ELLWELzlKLTBTU16iKsKiteyAVcCqqtP7ha4q+7y3JZtqbvGG9HvPuLNPAplbmRzdHJlYW0gZW5kb2JqCjUgMCBvYmogPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+IGVuZG9iago2IDAgb2JqIDw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYS1Cb2xkID4+IGVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNTEgMDAwMDAgbiAKMDAwMDAwMDcxMiAwMDAwMCBuIAowMDAwMDAwNzgyIDAwMDAwIG4gCnRyYWlsZXIgPDwgL1NpemUgNyAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKODU3CiUlRU9GCg==', (SELECT MIN(id) FROM dbo.users));
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Deed-Draft-v1.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Deed-Draft-v1.pdf', N'application/pdf', 1070, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggMzk5IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nHWSUW+bMBSF3/srzmMrbdRGQMkja2hUiSYR8SZN6sttbBIqsCubZH9/JkAbaUO2kYDj8137HhYkHCzgkX+EHPYAhpSFiBcxIgarUN38ELh/CsETiAr8MrzO/015DCFx+1if66ZWNi+3+I5CHahBa+SpUXcQ78jFDQvSuCdclt88WfLe0js9pOzitMtetkWO5ebx50u+Ft7taVNC5DvxvF5hsy5++0/rjUCGIl9lxafyE4R+XBHSiRANte6oUZBKSUhLVYcz946O2o+vYv8pjg/F/VJaGutG2UDgoyzkX7pM1/aNNFZH445zpkmaXsTbk90fySk7azspS3r/Q5LwrCtLWKqzasyHsg7bc4eik7OkJBlOvj+qq578BzQKyx2WdAAPWYx7FOXwlvIHvN4qa419vZtlRdGQCKNdLZWlrjZ6HjiqS4dF/I0xP9nk7CPTJ2ZYUz85FiMoGq56pXQP8d0k57vaGkjqCJWxuAplgKxpoKlVDqQl9Kl96y+O+njX+672VZ5cMKL/AmcuzSIKZW5kc3RyZWFtIGVuZG9iago1IDAgb2JqIDw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PiBlbmRvYmoKNiAwIG9iaiA8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EtQm9sZCA+PiBlbmRvYmoKeHJlZgowIDcKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjUxIDAwMDAwIG4gCjAwMDAwMDA3MjIgMDAwMDAgbiAKMDAwMDAwMDc5MiAwMDAwMCBuIAp0cmFpbGVyIDw8IC9TaXplIDcgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjg2NwolJUVPRgo=', (SELECT MIN(id) FROM dbo.users));
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Deed-Draft-v2.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Deed-Draft-v2.pdf', N'application/pdf', 1078, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggNDA3IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nHWSUU+sMBCF3/0V58VEE8WWALKP6OLGBHc3wL2JiS/jtuxioJgW9v79WxbQTZS0JWF6er7JzDAn4GAO9+zH5dB7MITMhb/w4TFoieLiIcfdkwseIC/AT8vq7G3IfeQCV4/lsaxKqeN0i1skck8V6kZ0lbxG/oE4v2BO6PeE07GPJ0veW1qn+5CdnLLoZZvEWG4e/7zE69y6PW1S5HGWP69X2KyTVxtab3JESOJVlHwpv0Do1xkhnAjekGtGlYSQUkBoKlocXetoqP78TvZHcnxI7q9UotFmlA0EPspc/q2LVKnfSWF1aMwBb1cBu3y7vkHW1WdBrw/OEYMwPDltO707kJF6ljkpU/r4R4LwrApNWMqjrJpPqQ22xxZJK2ZJQTCUZXeQZw37BTQK0wxL2oO7zMcdknT4C+/5LMHzhiFplCmF1NSWjZrHjOrUYOHfMGY3m5ztFPVDNJypxRyLEeQN1V9J1UNsg8nYRtcNBLWEotE4m1MHUVVBUS0NSAmorn7vy0X9xJe7trRZdsYZ0f8BXoTRnwplbmRzdHJlYW0gZW5kb2JqCjUgMCBvYmogPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+IGVuZG9iago2IDAgb2JqIDw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYS1Cb2xkID4+IGVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNTEgMDAwMDAgbiAKMDAwMDAwMDczMCAwMDAwMCBuIAowMDAwMDAwODAwIDAwMDAwIG4gCnRyYWlsZXIgPDwgL1NpemUgNyAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKODc1CiUlRU9GCg==', (SELECT MIN(id) FROM dbo.users));
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Stamp-Duty-Assessment.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Stamp-Duty-Assessment.pdf', N'application/pdf', 1036, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggMzY1IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nI2SXWuDMBiF7/srzmULrUtEXXrZtVYGfpQ2uxj0JptpcfNjGC3s3y9+tWVDGDFBzHmfc3h9ieFQEINa+jApyjMIGDFhL21YBKXEafLE8bA1QR3wE2i7tE7fMmqDx5iuk0uSJrJ09zss4MuzSJEVcZ3KGfgHXD4hBrMbh3br4gFJG6QmPTLSkg6rYOe72ETrl8ANuaZtoz24e+DPoYco9F/1pzDiWMF3vZV/VV6N0Kw7BzY4WF3WQyWyL8R19Q25EEpJpTKZVxqr9MUt8Z+EtEsYiPJTVriItB60nRfttSa9ifcKSzYnRD9kDOww9ivYKHaQaqw9Zw2Y4Djtch9nowaO01XJc6KqUlRJkeMkx9NfC/r0/zKxrLbG24fj3F6zcYNoQZemeWuKHpBmPro9/D2KZU+3unZ6Mpc6v4whFGKZFYhFJXAqStyNoIFVmiIXmVQQeYy8zt5kqd+bYU7eq0Q3oFZGb/0Df2bFOQplbmRzdHJlYW0gZW5kb2JqCjUgMCBvYmogPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+IGVuZG9iago2IDAgb2JqIDw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYS1Cb2xkID4+IGVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNTEgMDAwMDAgbiAKMDAwMDAwMDY4OCAwMDAwMCBuIAowMDAwMDAwNzU4IDAwMDAwIG4gCnRyYWlsZXIgPDwgL1NpemUgNyAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKODMzCiUlRU9GCg==', (SELECT MIN(id) FROM dbo.users));
GO
DECLARE @u INT = (SELECT MIN(id) FROM dbo.users);
DECLARE @raj INT = (SELECT TOP 1 LandId FROM dbo.LegalLand WHERE Remarks LIKE N'(Demo) Converted%');
DECLARE @f TABLE (n NVARCHAR(200), id INT);
INSERT INTO @f SELECT FileName, FileId FROM dbo.LegalMasterFile WHERE FileName LIKE N'SAMPLE-%';
DECLARE @lk TABLE (c NVARCHAR(40), n NVARCHAR(150), id INT);
INSERT INTO @lk SELECT Category, Name, LookupId FROM dbo.LegalLookupValue;
DECLARE @dec INT = (SELECT AreaUnitId FROM dbo.LegalAreaUnit WHERE UnitCode = N'DEC');
DECLARE @deb INT = (SELECT AdvocateId FROM dbo.LegalAdvocate WHERE EnrolmentNo = N'WB/1123/2008');
DECLARE @bdn INT = (SELECT OfficeId FROM dbo.LegalRegistrationOffice WHERE OfficeCode = N'ADSR-BDN');
DECLARE @buyer INT = (SELECT PersonId FROM dbo.LegalPerson WHERE PersonRole = N'Buyer' AND FullName = N'Rajwada Infra Developers Pvt Ltd');
DECLARE @yr NVARCHAR(4) = CAST(YEAR(SYSDATETIME()) AS NVARCHAR(4));
DECLARE @no NVARCHAR(30);

IF @raj IS NOT NULL AND @bdn IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalLandTransaction WHERE LandId = @raj)
BEGIN
  -- Step 8: the purchase.
  SET @no = N'TXN-' + @yr + N'-' + RIGHT('00000' + CAST(ISNULL((SELECT MAX(TRY_CAST(RIGHT(TransactionNo, 5) AS INT)) FROM dbo.LegalLandTransaction WHERE TransactionNo LIKE N'TXN-' + @yr + N'-%'), 0) + 1 AS VARCHAR(5)), 5);
  INSERT INTO dbo.LegalLandTransaction (TransactionNo, LandId, TxnType, BuyerName, BuyerId, SellerNames, TxnArea, AreaUnitId, RatePerUnit, TotalValue, AdvanceAmount, AgreementDate, ExpectedRegistrationDate,
    PaymentTerms, BrokerName, BrokerCommission, AdvocateFees, OtherExpenses, AgreementFileId, TxnStatus, Remarks, CreatedBy)
  VALUES (@no, @raj, N'Purchase', N'Rajwada Infra Developers Pvt Ltd', @buyer, N'Anirban Ghosh (60%), Suman Ghosh (40%)', 12.5, @dec, 760000, 9500000, 1000000, '2026-10-26', '2026-11-25',
    N'(Demo) ₹10 lakh advance on agreement; ₹30 lakh within 15 days; balance at registration.', N'Sanjay Mitra', 95000, 15000, 0,
    (SELECT id FROM @f WHERE n = N'SAMPLE-Agreement-for-Sale-Rajarhat.pdf'), N'Payment in Progress', N'(Demo)', @u);
  DECLARE @txn INT = (SELECT TransactionId FROM dbo.LegalLandTransaction WHERE TransactionNo = @no);

  -- Step 11: valuation & survey.
  INSERT INTO dbo.LegalValuation (LandId, ValuationDate, LandArea, AreaUnitId, MarketRate, EstimatedMarketValue, GovernmentValuation, ValuationSource, ValuationFileId,
    Surveyor, SurveyDate, SurveyFileId, GpsLatitude, GpsLongitude, BoundaryFindings, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
  VALUES (@raj, '2026-10-18', 12.5, @dec, 780000, 9750000, 9800000, N'Govt. market value: WB Registration portal (as on 18-10-2026); market: 3 recent sales in Mouza',
    (SELECT id FROM @f WHERE n = N'SAMPLE-Valuation-Report-Rajarhat.pdf'), N'Bikash Pal (licensed surveyor)', '2026-10-17', (SELECT id FROM @f WHERE n = N'SAMPLE-Map-Rajarhat.pdf'),
    22.6205000, 88.4640000, N'(Demo) Boundaries match the 2017 joint survey; no encroachment', N'Verified', @u, SYSUTCDATETIME(), N'(Demo)', @u);

  -- Step 12: the agreement, signed by both sides.
  SET @no = N'AGR-' + @yr + N'-' + RIGHT('00000' + CAST(ISNULL((SELECT MAX(TRY_CAST(RIGHT(AgreementNo, 5) AS INT)) FROM dbo.LegalAgreement WHERE AgreementNo LIKE N'AGR-' + @yr + N'-%'), 0) + 1 AS VARCHAR(5)), 5);
  INSERT INTO dbo.LegalAgreement (AgreementNo, LandId, TransactionId, AgreementType, AgreedArea, AreaUnitId, AgreedRate, TotalValue, AdvanceAmount, PaymentSchedule, AgreementDate,
    ExpectedRegistrationDate, ExpiryDate, Terms, BrokerDetails, AdvocateId, AgreementFileId, BuyerSignature, SellerSignature, AgreementStatus, ApprovedBy, ApprovedAt, Remarks, CreatedBy)
  VALUES (@no, @raj, @txn, N'Agreement for Sale', 12.5, @dec, 760000, 9500000, 1000000, N'(Demo) 10L on signing; 30L by 10-11-2026; 55L at registration', '2026-10-26',
    '2026-11-25', '2027-01-31', N'(Demo) Sellers to deliver attested heir certificate and nil acquisition report before registration.', N'Sanjay Mitra, commission 1%', @deb,
    (SELECT id FROM @f WHERE n = N'SAMPLE-Agreement-for-Sale-Rajarhat.pdf'), N'Signed', N'Signed', N'Signed', @u, SYSUTCDATETIME(), N'(Demo)', @u);
  DECLARE @agr INT = (SELECT AgreementId FROM dbo.LegalAgreement WHERE AgreementNo = @no);

  -- Step 13: approvals (Suman's signature still pending).
  INSERT INTO dbo.LegalPartyApproval (LandId, AgreementId, PartyName, PersonId, PartyRole, OwnershipSharePct, ConsentStatus, RecordedBy, RecordedAt, ApprovalDate, IdVerification, Remarks, CreatedBy)
  VALUES
    (@raj, @agr, N'Rajwada Infra Developers Pvt Ltd', @buyer, N'Buyer', NULL, N'Approved', @u, SYSUTCDATETIME(), '2026-10-26', N'Verified', N'(Demo) Board resolution on file', @u),
    (@raj, @agr, N'Anirban Ghosh', (SELECT PersonId FROM dbo.LegalPerson WHERE PersonRole = N'Seller' AND FullName = N'Anirban Ghosh'), N'Seller', 60, N'Approved', @u, SYSUTCDATETIME(), '2026-10-26', N'Verified', N'(Demo)', @u),
    (@raj, @agr, N'Suman Ghosh', NULL, N'Co-owner', 40, N'Signature Pending', NULL, NULL, NULL, N'Pending', N'(Demo) Will sign on return from Delhi', @u);

  -- Step 14: payments (advance verified, second instalment awaiting verification) and expenses.
  INSERT INTO dbo.LegalPayment (LandId, TransactionId, PaymentDate, TxnTypeId, Amount, PaymentModeId, Payer, Payee, BankRef, TransactionRef, ReceiptNo, ReceiptFileId, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
  VALUES
    (@raj, @txn, '2026-10-26', (SELECT id FROM @lk WHERE c = N'txn-type' AND n = N'Advance'), 1000000, (SELECT id FROM @lk WHERE c = N'payment-mode' AND n = N'Bank Transfer'),
     N'Rajwada Infra Developers Pvt Ltd', N'Anirban Ghosh & Suman Ghosh', N'HDFC current a/c', N'DEMO-NEFT-77120', N'R-001', (SELECT id FROM @f WHERE n = N'SAMPLE-Advance-Receipt-Rajarhat.pdf'), N'Verified', @u, SYSUTCDATETIME(), N'(Demo)', @u),
    (@raj, @txn, '2026-10-29', (SELECT id FROM @lk WHERE c = N'txn-type' AND n = N'Purchase Payment'), 3000000, (SELECT id FROM @lk WHERE c = N'payment-mode' AND n = N'Cheque'),
     N'Rajwada Infra Developers Pvt Ltd', N'Anirban Ghosh & Suman Ghosh', N'HDFC current a/c', N'Chq 004512', N'R-002', NULL, N'Pending', NULL, NULL, N'(Demo) Cheque yet to clear', @u);
  INSERT INTO dbo.LegalExpense (LandId, TransactionId, ExpenseTypeId, ExpenseDate, Amount, PaidTo, PaymentModeId, Remarks, CreatedBy)
  VALUES
    (@raj, @txn, (SELECT id FROM @lk WHERE c = N'expense-type' AND n = N'Advocate Fee'), '2026-10-25', 15000, N'Adv. Debjani Chatterjee', (SELECT id FROM @lk WHERE c = N'payment-mode' AND n = N'UPI'), N'(Demo) Title opinion', @u),
    (@raj, @txn, (SELECT id FROM @lk WHERE c = N'expense-type' AND n = N'Survey Fee'), '2026-10-17', 6000, N'Bikash Pal', (SELECT id FROM @lk WHERE c = N'payment-mode' AND n = N'Cash'), N'(Demo)', @u);

  -- Step 15–18: the deed, two drafts (v1 needed correction), the fee calculation, payments and the appointment.
  SET @no = N'DEED-' + @yr + N'-' + RIGHT('00000' + CAST(ISNULL((SELECT MAX(TRY_CAST(RIGHT(DeedCode, 5) AS INT)) FROM dbo.LegalLandDeed WHERE DeedCode LIKE N'DEED-' + @yr + N'-%'), 0) + 1 AS VARCHAR(5)), 5);
  INSERT INTO dbo.LegalLandDeed (DeedCode, LandId, TransactionId, DeedTypeId, LandDescription, ConsiderationAmount, DeedWriter, DeedWriterDueDate, AdvocateId, RegistrationOfficeId, RegistrationStatus, Remarks, CreatedBy)
  VALUES (@no, @raj, @txn, (SELECT DeedTypeId FROM dbo.LegalDeedType WHERE DeedTypeCode = N'SALE'),
    N'(Demo) All that piece of Bastu land measuring 12.5 decimal in RS Dag 1205 / LR Dag 1871, Mouza Rajarhat, J.L. 105, P.S. Rajarhat, District North 24 Parganas.',
    9500000, N'Pradip Saha (licensed deed writer)', '2026-11-05', @deb, @bdn, N'Draft Under Review', N'(Demo)', @u);
  DECLARE @deed INT = (SELECT DeedId FROM dbo.LegalLandDeed WHERE DeedCode = @no);

  INSERT INTO dbo.LegalDeedDraft (LandId, DeedId, VersionNo, DraftDate, DraftFileId, ChangeNotes, ReviewStatus, ReviewedBy, ReviewedAt, ReviewRemarks, CreatedBy)
  VALUES
    (@raj, @deed, 1, '2026-11-01', (SELECT id FROM @f WHERE n = N'SAMPLE-Deed-Draft-v1.pdf'), NULL, N'Correction Required', @u, SYSUTCDATETIME(), N'(Demo) LR Dag written as 1817; Suman''s share missing', @u),
    (@raj, @deed, 2, '2026-11-03', (SELECT id FROM @f WHERE n = N'SAMPLE-Deed-Draft-v2.pdf'), N'(Demo) LR Dag corrected to 1871; both sellers'' shares added', N'Pending', NULL, NULL, NULL, @u);
  DECLARE @checks TABLE (k NVARCHAR(60), v1 NVARCHAR(20), v2 NVARCHAR(20));
  INSERT INTO @checks VALUES
    (N'Buyer details correct', N'Correct', N'Correct'), (N'Seller details correct', N'Correct', N'Correct'), (N'Ownership shares correct', N'Incorrect', N'Correct'),
    (N'Land area correct', N'Correct', N'Correct'), (N'Mouza and JL Number correct', N'Correct', N'Correct'), (N'RS Khatian and Dag correct', N'Correct', N'Correct'),
    (N'LR Khatian and Dag correct', N'Incorrect', N'Correct'), (N'Boundary details correct', N'Correct', N'Correct'), (N'Consideration amount correct', N'Correct', N'Correct'),
    (N'Deed type correct', N'Correct', N'Correct'), (N'Registration office correct', N'Correct', N'Pending'), (N'Required attachments available', N'Correct', N'Pending');
  INSERT INTO dbo.LegalDeedDraftCheck (LandId, DraftId, CheckItem, Result, CheckedBy, CheckedAt, Remarks, CreatedBy)
  SELECT @raj, d.DraftId, c.k, CASE d.VersionNo WHEN 1 THEN c.v1 ELSE c.v2 END,
         CASE WHEN (CASE d.VersionNo WHEN 1 THEN c.v1 ELSE c.v2 END) <> N'Pending' THEN @u END,
         CASE WHEN (CASE d.VersionNo WHEN 1 THEN c.v1 ELSE c.v2 END) <> N'Pending' THEN SYSUTCDATETIME() END,
         CASE WHEN d.VersionNo = 1 AND c.v1 = N'Incorrect' THEN N'(Demo) See review remarks' END, @u
  FROM dbo.LegalDeedDraft d CROSS JOIN @checks c WHERE d.DeedId = @deed;

  INSERT INTO dbo.LegalStampDuty (LandId, DeedId, GovtMarketValue, ConsiderationValue, ValuationBasis, StampDuty, RegistrationFee, ScanningFee, OtherCharges, TotalPayable,
    CalculationDate, CalculationSource, SupportingFileId, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
  VALUES (@raj, @deed, 9800000, 9500000, N'Higher of market value and consideration', 588000, 98000, 300, 0, 686300, '2026-11-02',
    N'WB Registration portal — e-assessment slip (sample figures)', (SELECT id FROM @f WHERE n = N'SAMPLE-Stamp-Duty-Assessment.pdf'), N'Verified', @u, SYSUTCDATETIME(), N'(Demo) Figures are sample values', @u);
  INSERT INTO dbo.LegalRegPayment (LandId, DeedId, FeeTypeId, Amount, PaymentDate, PaymentRef, ReceiptFileId, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
  VALUES
    (@raj, @deed, (SELECT id FROM @lk WHERE c = N'fee-type' AND n = N'Stamp Duty'), 588000, '2026-11-03', N'GRN DEMO-192200', (SELECT id FROM @f WHERE n = N'SAMPLE-Stamp-Duty-Assessment.pdf'), N'Verified', @u, SYSUTCDATETIME(), N'(Demo)', @u),
    (@raj, @deed, (SELECT id FROM @lk WHERE c = N'fee-type' AND n = N'Registration Fee'), 98300, '2026-11-03', N'GRN DEMO-192201', NULL, N'Pending', NULL, NULL, N'(Demo) Includes scanning fee', @u);
  INSERT INTO dbo.LegalRegAppointment (LandId, DeedId, RegistrationOfficeId, AppointmentDate, AppointmentTime, TokenNo, WitnessDetails, AppointmentStatus, Remarks, CreatedBy)
  VALUES (@raj, @deed, @bdn, '2026-11-25', N'11:30', N'DEMO-TKN-4471', N'(Demo) Tapas Roy, Mousumi Das', N'Scheduled', N'(Demo)', @u);

  -- Pipeline: steps 8, 11 and 12 done; 13 and 14 in progress; 15 in progress.
  INSERT INTO dbo.LegalWorkflowStepState (LandId, StepCode, Status, ResponsibleUserId, Remarks, UpdatedBy)
  SELECT @raj, v.c, v.s, @u, v.r, @u FROM (VALUES
    (N'PURCHASE_SALE', N'Completed', N'(Demo) Purchase recorded'),
    (N'VALUATION', N'Completed', N'(Demo) Valuation verified'),
    (N'AGREEMENT', N'Completed', N'(Demo) Signed 26-10-2026'),
    (N'PARTY_APPROVAL', N'In Progress', N'(Demo) Suman''s signature pending'),
    (N'PAYMENT', N'In Progress', N'(Demo) Second instalment cheque to clear'),
    (N'DEED_PREP', N'In Progress', N'(Demo) Draft v2 under review')
  ) v (c, s, r)
  WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalWorkflowStepState x WHERE x.LandId = @raj AND x.StepCode = v.c);
  INSERT INTO dbo.LegalWorkflowStepHistory (LandId, StepCode, PreviousStatus, NewStatus, Remarks, ChangedBy)
  SELECT LandId, StepCode, NULL, Status, N'(Demo) sample data', @u FROM dbo.LegalWorkflowStepState
  WHERE LandId = @raj AND StepCode IN (N'PURCHASE_SALE', N'VALUATION', N'AGREEMENT', N'PARTY_APPROVAL', N'PAYMENT', N'DEED_PREP');
END;
GO

PRINT '600-legal-phase4-5-demo-data applied successfully.';
GO
