-- Splits the 13 uncategorized "packaging" UOMs into two finer groups so
-- relevantUOMs() filtering (src/lib/uomConversion.ts) offers a tighter,
-- more sensible list per item instead of lumping all 13 together.
--
-- Packaging  = discrete countable containers (box of tiles, bag of cement,
--              bundle of rebar, a set, a packet, a sheet, "numbers")
-- BulkHandling = transport/volume-ish containers (a can of paint, a coil of
--              wire, a truckload, a roll of sheeting, a trip)
--
-- Lump Sum (LS) is left uncategorized — it's a contract/service unit, not a
-- physical quantity, so it should never be offered as an alternative to a
-- real item UOM.
--
-- No BaseFactor is set (stays NULL/1, unused) — these still can't be
-- auto-converted into each other (a box isn't a fixed number of pieces),
-- only grouped for relevance filtering.

UPDATE dbo.UOMMaster SET UOMCategory = 'Packaging' WHERE UOMCode IN ('BOX', 'BAG', 'BDL', 'NOS', 'PKT', 'SET', 'SHT');
UPDATE dbo.UOMMaster SET UOMCategory = 'BulkHandling' WHERE UOMCode IN ('CAN', 'COI', 'LOD', 'ROL', 'TRP');
