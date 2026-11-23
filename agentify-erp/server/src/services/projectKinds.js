import { get, getSetting } from '../db.js';

/**
 * Which kinds of project a workspace uses: 'development' (plots, housing scheme) and 'construction' (house-building contracts).
 * Setting `project_types`: 'auto' (default: follow the products of the plan, and anything already created stays visible),
 * 'both', 'development' or 'construction'.
 */
export const PROJECT_TYPE_CHOICES = ['auto', 'both', 'development', 'construction'];

export function projectKinds(products) {
  const choice = getSetting('project_types', 'auto');
  if (choice === 'both') return { development: true, construction: true };
  if (choice === 'development') return { development: true, construction: false };
  if (choice === 'construction') return { development: false, construction: true };
  const list = Array.isArray(products) ? products : ['real_estate', 'construction'];
  const used = (kind) => !!get('SELECT 1 x FROM projects WHERE kind=? LIMIT 1', kind);
  const construction = list.includes('construction') || used('construction') || !!get(`SELECT 1 x FROM sales WHERE kind='construction' LIMIT 1`);
  const development = list.includes('real_estate') || used('development');
  // never leave a workspace with neither
  return { development: development || !construction, construction };
}
