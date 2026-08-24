const MAX_SANE_PERCENT = 10;

function assertSanePercentRate(rateType, rateValue, dealValue = null) {
  const rate = Number(rateValue);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('RateValue must be a positive number');
  }
  if (rateType === 'Percentage' && rate > MAX_SANE_PERCENT) {
    throw new Error(`Brokerage percentage of ${rate}% looks like a mistake (max allowed is ${MAX_SANE_PERCENT}%) - check whether this should be a smaller percentage or a Fixed Amount instead`);
  }
  if (rateType === 'Amount' && dealValue !== null) {
    const maxAmount = (dealValue * MAX_SANE_PERCENT) / 100;
    if (rate > maxAmount) {
      throw new Error(`Brokerage flat amount of ${rate} exceeds ${MAX_SANE_PERCENT}% of deal value (${maxAmount}) and looks like a mistake`);
    }
  }
}

module.exports = { assertSanePercentRate, MAX_SANE_PERCENT };

