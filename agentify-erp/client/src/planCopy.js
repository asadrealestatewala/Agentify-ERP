// Plan wording for the currency a buyer pays in. A plan row has one description and feature list; plans sold in several currencies can carry
// `regional[currency]` wording (for example the USA version of the plan ladder) and that is used when it exists.
export const planText = (plan, cur) => {
  const r = plan?.regional?.[cur] || {};
  return { description: r.description ?? plan?.description ?? null, features: r.features ?? plan?.features ?? [] };
};
/** Plans a buyer paying in `cur` can actually buy: those with a monthly price in that currency. */
export const pricedIn = (plans, cur) => (plans || []).filter((p) => p.price?.[cur]?.month != null);
