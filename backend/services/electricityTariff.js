// Shared electricity billing calculation — single source of truth so the
// preview endpoint and the persist endpoint can never disagree (the
// preview computes with this, and POST /bills recomputes with the exact
// same function rather than trusting a client-sent amount).

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Picks the Active tariff for a provider/billing-cycle whose effective
 * window covers the end of the billing period being calculated. Most
 * recent EffectiveFrom wins if more than one somehow matches.
 */
async function findApplicableTariff(pool, sql, { providerId, billingCycle, periodEndDate }) {
  const result = await pool
    .request()
    .input("ProviderId", sql.Int, providerId)
    .input("BillingCycle", sql.NVarChar, billingCycle)
    .input("PeriodEnd", sql.Date, periodEndDate)
    .query(`
      SELECT TOP 1 *
      FROM dbo.ElectricityTariff
      WHERE ProviderId = @ProviderId
        AND BillingCycle = @BillingCycle
        AND Status = 'Active'
        AND EffectiveFrom <= @PeriodEnd
        AND (EffectiveTo IS NULL OR EffectiveTo >= @PeriodEnd)
      ORDER BY EffectiveFrom DESC
    `);
  return result.recordset[0] || null;
}

async function getTariffSlabs(pool, sql, tariffId) {
  const result = await pool
    .request()
    .input("TariffId", sql.Int, tariffId)
    .query(`SELECT * FROM dbo.ElectricityTariffSlab WHERE TariffId = @TariffId ORDER BY SlabFrom ASC`);
  return result.recordset;
}

/**
 * Telescoping slab calculation: units falling within each slab's
 * [SlabFrom, SlabTo] range are charged at that slab's rate (SlabTo=NULL
 * means open-ended, "Y+ units"). Adds the tariff's FixedCharge and
 * AdditionalCharge, then floors the total at MinimumCharge if set.
 */
function calculateElectricityCharge(units, tariff, slabs) {
  const u = Number(units) || 0;
  const fixedCharge = round2(tariff?.FixedCharge);
  const additionalCharge = round2(tariff?.AdditionalCharge);
  const minimumCharge = round2(tariff?.MinimumCharge);

  let energyCharge = 0;
  if (Array.isArray(slabs) && slabs.length > 0) {
    let remaining = u;
    for (const slab of slabs) {
      if (remaining <= 0) break;
      const from = Number(slab.SlabFrom) || 0;
      const to = slab.SlabTo === null || slab.SlabTo === undefined ? Infinity : Number(slab.SlabTo);
      // Units already billed by earlier slabs are implicitly excluded
      // because we work off `remaining` directly rather than absolute
      // meter positions — each slab consumes up to its own width.
      const widthAvailable = to === Infinity ? Infinity : Math.max(0, to - from);
      const unitsInSlab = Math.min(remaining, widthAvailable);
      energyCharge += unitsInSlab * (Number(slab.RatePerUnit) || 0);
      remaining -= unitsInSlab;
    }
    // Any units beyond the highest defined slab (misconfigured tariff —
    // no open-ended top slab) fall back to the last slab's rate rather
    // than silently going unbilled.
    if (remaining > 0 && slabs.length > 0) {
      const lastRate = Number(slabs[slabs.length - 1].RatePerUnit) || 0;
      energyCharge += remaining * lastRate;
    }
  }
  energyCharge = round2(energyCharge);

  let totalAmount = round2(energyCharge + fixedCharge + additionalCharge);
  if (minimumCharge > 0 && totalAmount < minimumCharge) {
    totalAmount = minimumCharge;
  }

  return {
    energyCharge,
    fixedCharge,
    otherCharge: additionalCharge,
    totalAmount,
  };
}

/**
 * Maps a dbo.CrmHandover row (or none) to the three statuses the
 * Electricity Maintenance spec works with. A Cancelled handover reverts
 * to "Not Handed Over" for electricity-supply purposes.
 */
function resolveHandoverStatus(handoverRow) {
  if (!handoverRow) return { status: "Not Handed Over", handoverDate: null };
  if (handoverRow.Status === "Completed") {
    return { status: "Handover Completed", handoverDate: handoverRow.ActualHandoverDate || null };
  }
  if (handoverRow.Status === "Cancelled") {
    return { status: "Not Handed Over", handoverDate: null };
  }
  return { status: "Handover Scheduled", handoverDate: handoverRow.ScheduledDate || null };
}

module.exports = {
  findApplicableTariff,
  getTariffSlabs,
  calculateElectricityCharge,
  resolveHandoverStatus,
  round2,
};
