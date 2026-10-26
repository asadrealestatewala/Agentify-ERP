// Region runtime: turns a workspace (tenant row) into formatting/units/phone helpers, with no database access of its own
// so that util.js can use it without import cycles. The platform database layer (regions/index.js) feeds it the
// console-edited pack versions and flags through setOverrides().
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegion, PK_DEFAULTS } from '../../../shared/region/index.js';
import { currentTenant } from '../context.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK_DIR = path.join(here, 'packs');

/** Pack files shipped with the code (the seed for the console-editable versions in platform.db). */
export const FILE_PACKS = Object.fromEntries(fs.readdirSync(PACK_DIR).filter((f) => f.endsWith('.json'))
  .map((f) => { const p = JSON.parse(fs.readFileSync(path.join(PACK_DIR, f), 'utf8')); return [p.code, p]; }));
export const REGION_CODES = Object.keys(FILE_PACKS);

let overrides = new Map(); // code -> { manifest, flags }
const cache = new Map();
/** Called by regions/index.js with the newest effective manifest and flag switches of every region. */
export function setOverrides(map) { overrides = map; cache.clear(); }

export const packOf = (code) => overrides.get(code)?.manifest || FILE_PACKS[code] || FILE_PACKS.PK;
const parse = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };

/** The effective configuration of a workspace: pack, then the workspace's own columns on top. */
export function configFor(tenant) {
  const code = tenant?.region && (FILE_PACKS[tenant.region] || overrides.has(tenant.region)) ? tenant.region : 'PK';
  const p = packOf(code);
  const o = overrides.get(code);
  const tenantFlags = parse(tenant?.flags);
  return {
    ...PK_DEFAULTS, ...p, region: code, sub_region: tenant?.sub_region || null,
    currency: tenant?.currency || p.currency,
    money_scale: Number.isInteger(tenant?.money_scale) ? tenant.money_scale : (p.money_scale ?? 0),
    timezone: tenant?.timezone || p.timezone,
    locale: tenant?.locale || p.locale,
    language: tenant?.language || p.language || 'en',
    units_system: tenant?.units_system || p.units_system,
    pack_version: p.version,
    flags: { ...(p.flags || {}), ...(o?.flags || {}), ...tenantFlags },
  };
}

/** Helpers for a tenant row (cached per effective configuration). */
export function regionFor(tenant) {
  const c = configFor(tenant);
  const key = JSON.stringify([c.region, c.pack_version, c.currency, c.money_scale, c.locale, c.timezone, c.date_style, c.time_style, c.marla_sqft, c.phone, c.currency_style, c.language, c.units_system, c.terminology, c.flags, c.sub_region]);
  let r = cache.get(key);
  if (!r) { r = { ...buildRegion(c), config: c }; cache.set(key, r); }
  return r;
}
/** Helpers for the workspace the current request runs in (Pakistan defaults outside a workspace). */
export const currentRegion = () => regionFor(currentTenant());
export const flagOn = (tenant, name) => !!configFor(tenant).flags[name];

/** What the browser needs (no rules, no internals). */
export function clientConfig(tenant) {
  const c = configFor(tenant);
  return {
    region: c.region, sub_region: c.sub_region, name: c.name, locale: c.locale, language: c.language, languages: c.languages, direction: regionFor(tenant).dir, currency: c.currency, money_scale: c.money_scale,
    currency_style: c.currency_style, date_style: c.date_style, time_style: c.time_style, timezone: c.timezone, units_system: c.units_system, distance_unit: c.distance_unit || 'km', timezones: c.timezones || [c.timezone], area_units: c.area_units, default_area_unit: c.default_area_unit,
    marla_sqft: c.marla_sqft, phone: c.phone, sub_region_label: c.sub_region_label, sub_regions: c.sub_regions, terminology: c.terminology, identity: c.identity, flags: c.flags, pack_version: c.pack_version,
    price_style: c.price_style, rent_suffix: c.rent_suffix, property_types: c.property_types, listing_fields: c.listing_fields, area: c.area, calculators: c.calculators, fees: c.fees, site_copy: c.site_copy, mortgage_compounding: c.mortgage_compounding,
  };
}
