const telHref = (p) => `tel:${String(p || '').replace(/[^\d+]/g, '')}`;
/** Support phone numbers by region, as tel: links. */
export function phoneLinks(c) {
  return [[c.contact_phone, 'USA'], [c.contact_phone_pk, 'Pakistan (sales and delivery center)']].filter(([p]) => p).map(([p, l]) => ({ phone: p, label: l, href: telHref(p) }));
}
