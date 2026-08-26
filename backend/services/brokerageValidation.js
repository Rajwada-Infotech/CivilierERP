// Sanity bounds on a brokerage rate before it's ever stored — a fat-fingered
// entry here (e.g. typing "20" meaning 2%, or an amount meaning to be a
// percent) turns into real money nobody catches until Finance is asked to
// pay it. Real-estate brokerage in this business is 1-2% by convention (see
// tierBrokeragePercent in crmWorkflowGuards.js); this caps well above that
// to allow genuine deal-specific overrides without allowing nonsense.
const MAX_SANE_PERCENT = 10;

// A flat ("Amount") brokerage has no inherent ceiling the way a percentage
// does, so when the caller knows the deal value we hold it to the same
// effective bound: MAX_SANE_PERCENT of the deal. Callers that genuinely
// don't have a deal value yet pass null and only the positive-number check
// applies.
function assertSanePercentRate(rateType, rateValue, dealValue = null) {
  const rate = Number(rateValue);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("RateValue must be a positive number");
  }
  if (rateType === "Percentage" && rate > MAX_SANE_PERCENT) {
    throw new Error(`Brokerage percentage of ${rate}% looks like a mistake (max allowed is ${MAX_SANE_PERCENT}%) — check whether this should be a smaller percentage or a Fixed Amount instead`);
  }
  if (rateType === "Amount" && dealValue !== null) {
    const deal = Number(dealValue);
    if (Number.isFinite(deal) && deal > 0) {
      const maxAmount = (deal * MAX_SANE_PERCENT) / 100;
      if (rate > maxAmount) {
        throw new Error(`Brokerage flat amount of ${rate} exceeds ${MAX_SANE_PERCENT}% of the deal value (${maxAmount}) and looks like a mistake — check whether this should be a smaller amount or a Percentage instead`);
      }
    }
  }
}

module.exports = { assertSanePercentRate, MAX_SANE_PERCENT };
