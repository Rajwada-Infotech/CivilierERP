// Sanity bounds on a brokerage rate before it's ever stored — a fat-fingered
// entry here (e.g. typing "20" meaning 2%, or an amount meaning to be a
// percent) turns into real money nobody catches until Finance is asked to
// pay it. Real-estate brokerage in this business is 1-2% by convention (see
// tierBrokeragePercent in crmWorkflowGuards.js); this caps well above that
// to allow genuine deal-specific overrides without allowing nonsense.
const MAX_SANE_PERCENT = 10;

function assertSanePercentRate(rateType, rateValue) {
  const rate = Number(rateValue);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("RateValue must be a positive number");
  }
  if (rateType === "Percentage" && rate > MAX_SANE_PERCENT) {
    throw new Error(`Brokerage percentage of ${rate}% looks like a mistake (max allowed is ${MAX_SANE_PERCENT}%) — check whether this should be a smaller percentage or a Fixed Amount instead`);
  }
}

module.exports = { assertSanePercentRate, MAX_SANE_PERCENT };
