/**
 * The one icon component for tenant websites (public pages, the studio canvas and the icon picker all use it).
 * Takes a semantic id from shared/siteIcons.js, or a legacy emoji that the registry maps, and draws a Tabler outline icon.
 * Only the icons imported below end up in the website bundle; ids never reach an import, so visitors cannot load others.
 *
 * Decorative by default (aria-hidden) because website icons sit next to text that says the same thing. Pass `label`
 * only when the icon is the sole content of something meaningful; icon-only buttons and links should carry their own
 * aria-label instead.
 */
import {
  IconAward, IconBath, IconBed, IconBrandWhatsapp, IconBuilding, IconBuildingCommunity, IconBuildingSkyscraper,
  IconCalendarEvent, IconCamera, IconCar, IconCash, IconChartLine, IconChecklist, IconCircleDot, IconClock, IconCrane,
  IconCreditCard, IconDeviceLandlinePhone, IconDiamond, IconFileText, IconHeartHandshake, IconHome, IconHomeDollar,
  IconKey, IconMail, IconMapPin, IconMessageCircle, IconNews, IconPhone, IconPhoto, IconReceipt, IconRulerMeasure,
  IconSearch, IconShieldCheck, IconStar, IconTag, IconTools, IconTrees, IconUser, IconUsers, IconWheat,
} from '@tabler/icons-react';
import { FALLBACK_ICON, resolveIconId } from '../../../shared/siteIcons.js';

/** Semantic id -> Tabler component. Keep in step with SITE_ICONS (a server test checks both lists match). */
export const ICON_COMPONENTS = {
  residential: IconHome,
  construction: IconCrane,
  commercial: IconBuildingSkyscraper,
  agricultural: IconWheat,
  land: IconTrees,
  apartment: IconBuilding,
  city: IconBuildingCommunity,
  key: IconKey,
  sell: IconTag,
  valuation: IconHomeDollar,
  tools: IconTools,
  location: IconMapPin,
  area: IconRulerMeasure,
  bedrooms: IconBed,
  bathrooms: IconBath,
  parking: IconCar,
  photos: IconCamera,
  installments: IconCreditCard,
  agent: IconUser,
  team: IconUsers,
  phone: IconPhone,
  landline: IconDeviceLandlinePhone,
  email: IconMail,
  whatsapp: IconBrandWhatsapp,
  chat: IconMessageCircle,
  search: IconSearch,
  calendar: IconCalendarEvent,
  hours: IconClock,
  verified: IconShieldCheck,
  paperwork: IconFileText,
  receipt: IconReceipt,
  handshake: IconHeartHandshake,
  investment: IconCash,
  growth: IconChartLine,
  award: IconAward,
  checklist: IconChecklist,
  star: IconStar,
  diamond: IconDiamond,
  news: IconNews,
  image: IconPhoto,
  dot: IconCircleDot,
};

/** Standard sizes (px): inline with text, controls, and the icon on a service card. Stroke stays 1.75 everywhere. */
export const ICON_SIZE = { inline: 18, control: 22, card: 36 };
export const ICON_STROKE = 1.75;

export default function SiteIcon({ name, size = ICON_SIZE.control, stroke = ICON_STROKE, label, className = '', style }) {
  const id = resolveIconId(name);
  if (!id) return null;
  const C = ICON_COMPONENTS[id] || ICON_COMPONENTS[FALLBACK_ICON];
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return <C size={size} stroke={stroke} className={`sicon ${className}`.trim()} style={style} focusable="false" data-icon={id} {...a11y} />;
}

/** A small decorative icon in front of text that already says what it is (location, phone, email…). */
export const Ic = ({ n }) => <SiteIcon name={n} size={ICON_SIZE.inline} className="sicon-inline" />;
