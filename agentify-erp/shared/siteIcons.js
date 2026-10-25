/**
 * The approved website icons, by stable semantic id. Pages store these ids (never a library component name, SVG markup
 * or a URL); the browser maps each id to a Tabler outline icon in client/src/site/SiteIcon.jsx, and the server keeps
 * saved values to this list (normalizeIconValue, called from server/src/services/siteValidate.js).
 *
 * Adding an icon: see docs/website-icons.md. In short, add the id here (with a plain label and group), map it to an
 * existing @tabler/icons-react export in SiteIcon.jsx, and add search words in pages/website/IconPicker.jsx.
 * Never rename or remove an id that tenants may already have saved; point it at a different Tabler icon instead.
 */
export const SITE_ICONS = {
  // Property and services
  residential: { label: 'House', group: 'Property' },
  construction: { label: 'Crane / build', group: 'Property' },
  commercial: { label: 'Office tower', group: 'Property' },
  agricultural: { label: 'Farm land', group: 'Property' },
  land: { label: 'Trees / plot', group: 'Property' },
  apartment: { label: 'Apartments', group: 'Property' },
  city: { label: 'City area', group: 'Property' },
  key: { label: 'Key / rent', group: 'Property' },
  sell: { label: 'Price tag', group: 'Property' },
  valuation: { label: 'Home value', group: 'Property' },
  tools: { label: 'Tools', group: 'Property' },
  // Listing facts
  location: { label: 'Location', group: 'Listing facts' },
  area: { label: 'Area / size', group: 'Listing facts' },
  bedrooms: { label: 'Bedrooms', group: 'Listing facts' },
  bathrooms: { label: 'Bathrooms', group: 'Listing facts' },
  parking: { label: 'Parking', group: 'Listing facts' },
  photos: { label: 'Camera', group: 'Listing facts' },
  installments: { label: 'Card / plan', group: 'Listing facts' },
  // People and contact
  agent: { label: 'Agent', group: 'People and contact' },
  team: { label: 'Team', group: 'People and contact' },
  phone: { label: 'Phone', group: 'People and contact' },
  landline: { label: 'Landline', group: 'People and contact' },
  email: { label: 'Email', group: 'People and contact' },
  whatsapp: { label: 'WhatsApp', group: 'People and contact' },
  chat: { label: 'Chat', group: 'People and contact' },
  search: { label: 'Search', group: 'People and contact' },
  calendar: { label: 'Calendar', group: 'People and contact' },
  hours: { label: 'Opening hours', group: 'People and contact' },
  // Trust and process
  verified: { label: 'Verified', group: 'Trust and process' },
  paperwork: { label: 'Documents', group: 'Trust and process' },
  receipt: { label: 'Receipt', group: 'Trust and process' },
  handshake: { label: 'Handshake', group: 'Trust and process' },
  investment: { label: 'Money', group: 'Trust and process' },
  growth: { label: 'Growth', group: 'Trust and process' },
  award: { label: 'Award', group: 'Trust and process' },
  checklist: { label: 'Checklist', group: 'Trust and process' },
  star: { label: 'Star', group: 'Trust and process' },
  diamond: { label: 'Diamond', group: 'Trust and process' },
  news: { label: 'News', group: 'Trust and process' },
  image: { label: 'Picture', group: 'Trust and process' },
  dot: { label: 'Plain dot', group: 'Trust and process' },
};

export const SITE_ICON_IDS = Object.keys(SITE_ICONS);

/** Shown for a value that is not empty but not (or no longer) an approved id. */
export const FALLBACK_ICON = 'dot';

/**
 * Emoji that older pages, templates and themes stored in icon fields, mapped to the semantic id that replaces them.
 * Variation selectors (U+FE0F) are stripped before lookup, so '🏗️' and '🏗' both match.
 */
export const LEGACY_ICON_MAP = {
  '🏡': 'residential', '🏠': 'residential', '🏘': 'residential',
  '🏗': 'construction', '🚧': 'construction', '👷': 'construction',
  '🏢': 'commercial', '🏬': 'commercial', '🏪': 'commercial',
  '🌾': 'agricultural', '🌱': 'agricultural', '🌿': 'agricultural', '🚜': 'agricultural',
  '🌳': 'land', '🌲': 'land',
  '🏙': 'city', '🌆': 'city', '🏛': 'city',
  '🔑': 'key', '🗝': 'key',
  '🏷': 'sell',
  '🛠': 'tools', '🔧': 'tools', '🧰': 'tools', '🔨': 'tools',
  '📍': 'location', '🗺': 'location',
  '📐': 'area', '📏': 'area',
  '🛏': 'bedrooms', '🛁': 'bathrooms', '🚿': 'bathrooms', '🚗': 'parking', '🅿': 'parking',
  '📸': 'photos', '📷': 'photos',
  '💳': 'installments',
  '👤': 'agent', '🧑‍💼': 'agent', '👔': 'agent', '👥': 'team',
  '📞': 'phone', '📱': 'phone', '☎': 'landline', '✉': 'email', '📧': 'email', '📩': 'email',
  '💬': 'chat', '🔍': 'search', '🔎': 'search', '📅': 'calendar', '🗓': 'calendar', '🕘': 'hours', '⏰': 'hours',
  '✅': 'verified', '✔': 'verified', '🛡': 'verified',
  '📄': 'paperwork', '📃': 'paperwork', '📝': 'paperwork', '🧾': 'receipt',
  '🤝': 'handshake', '💰': 'investment', '💵': 'investment', '📈': 'growth', '🏆': 'award', '🥇': 'award',
  '📋': 'checklist', '⭐': 'star', '★': 'star', '🌟': 'star', '◆': 'diamond', '💎': 'diamond',
  '📰': 'news', '🖼': 'image',
};

/**
 * What a stored icon value shows: an approved id, '' for "no icon", or FALLBACK_ICON for anything else
 * (an unmapped emoji, a removed id, text a tenant typed). Never returns a value outside SITE_ICON_IDS or ''.
 */
export function resolveIconId(value) {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  if (!v) return '';
  if (Object.prototype.hasOwnProperty.call(SITE_ICONS, v)) return v;
  const lower = v.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(SITE_ICONS, lower)) return lower;
  const bare = v.replace(/️/g, '');
  if (Object.prototype.hasOwnProperty.call(LEGACY_ICON_MAP, bare)) return LEGACY_ICON_MAP[bare];
  return FALLBACK_ICON;
}

/** The value to store when a page is saved: the same as resolveIconId, so a page only ever keeps approved ids. */
export const normalizeIconValue = resolveIconId;
