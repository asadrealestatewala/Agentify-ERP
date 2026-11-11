// Billing-term discounts: how much a longer billing period takes off 'months x monthly price'.
// ONE place to change them. Every plan and recurring add-on price for a 6-month ('half') or 12-month ('year') period is derived from the
// monthly price with these percentages (see termPrice / periodPrices in server/src/services/planLadder.js, and the one-off re-pricing
// migration in plansStore.js). Add a currency under `byCurrency` to give one country its own percentages; anything not listed uses `default`.
export const TERM_DISCOUNTS = {
  default: { half: 5, year: 10 },
  // Every launch country (Pakistan, USA, UK, UAE, Canada) currently shares the default. To give one currency its own percentages add e.g. USD: { half: 5, year: 12 }.
  byCurrency: {},
};
export const TERM_MONTHS = { half: 6, year: 12 };
/** Percent off for a period ('half' | 'year') in a currency; 0 for monthly or an unknown period. */
export const termDiscountPercent = (interval, currency = null) => {
  if (!TERM_MONTHS[interval]) return 0;
  const v = TERM_DISCOUNTS.byCurrency[String(currency || '').toUpperCase()]?.[interval] ?? TERM_DISCOUNTS.default[interval];
  return Number.isFinite(Number(v)) && v >= 0 && v < 100 ? Number(v) : 0;
};
/** Price for `interval` from the monthly price: months x monthly, less the term discount, rounded to a whole amount. */
export const termPrice = (month, interval, currency = null) => (interval === 'month' ? month : Math.round(month * TERM_MONTHS[interval] * (1 - termDiscountPercent(interval, currency) / 100)));
/** { month, half, year } for a monthly price in a currency. */
export const periodPricesFor = (month, currency = null) => ({ month, half: termPrice(month, 'half', currency), year: termPrice(month, 'year', currency) });
