// What Ask knows about the system itself. The facts are read from the code at run time (permission modules, default roles,
// pick-lists, chart of accounts, workspace settings, regional packs) so they cannot drift; plain-words notes live in
// shared/systemNotes.js and the end-to-end flows in shared/workflows.js. server/test/system-knowledge.test.js keeps them in step.
import { MODULES, ACTIONS } from '../rbac.js';
import { ROLES, LOOKUPS, COA } from '../seed.js';
import { SETTING_KEYS } from '../routes/settings.js';
import { FILE_PACKS } from '../regions/runtime.js';
import { ACTION_NOTES, MODULE_NOTES, SETTING_NOTES, LOOKUP_NOTES, FLAG_NOTES, ACCOUNT_GROUPS } from '../../../shared/systemNotes.js';
import { WORKFLOWS } from '../../../shared/workflows.js';
import { COUNTRIES } from '../../../shared/countryKnowledge.js';

const pretty = (k) => k.replace(/_/g, ' ');
const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

function roleDocs() {
  const docs = [];
  for (const r of ROLES) {
    const by = {};
    for (const p of r.perms || []) { const [m, a] = p.split(':'); (by[m] ||= []).push(a); }
    const lines = Object.entries(by).map(([m, acts]) => (acts.length === ACTIONS.length ? `${m} (everything)` : `${m} (${acts.join(', ')})`));
    const text = r.portal ? `${r.description}. This is a portal role: it signs in to a separate portal, not the staff screens.`
      : `${r.description}.${r.own_scope ? ' Sees only their own leads, customers and sales.' : ''} Permissions: ${lines.length > 8 ? `${lines.slice(0, 8).join('; ')} and ${lines.length - 8} more areas` : lines.join('; ')}.`;
    docs.push({ id: `role-${r.name}`, title: `${r.name} role: what it can do`, keywords: `role permission access ${r.name} who can see`, text, source: 'Roles' });
  }
  docs.push({ id: 'permissions', title: 'Permissions: how access works', keywords: 'permission permissions access role view create edit delete approve export print module', source: 'Roles',
    text: `Every role is a set of permissions. Each area (${list(MODULES)}) can allow: ${ACTIONS.map((a) => `${a} (${ACTION_NOTES[a]})`).join('; ')}. Edit roles in Settings > Roles & Permissions.` });
  for (const m of MODULES) docs.push({ id: `module-${m}`, title: `${m} permission area`, keywords: `permission module ${m}`, text: `${MODULE_NOTES[m]} People need ${m}:view to open it.`, source: 'Permissions' });
  return docs;
}

function settingDocs() {
  return SETTING_KEYS.map((k) => ({ id: `setting-${k}`, title: `Setting: ${pretty(k)}`, keywords: `setting settings ${pretty(k)} configure`, text: `${SETTING_NOTES[k]} Found under Settings.`, source: 'Settings' }));
}

function listDocs() {
  const types = [...new Set(LOOKUPS.map((l) => l.type))];
  return types.map((t) => {
    const [label, about] = LOOKUP_NOTES[t] || [pretty(t), ''];
    const vals = LOOKUPS.filter((l) => l.type === t).map((l) => l.value + (t === 'leave_type' ? ` (${l.meta?.quota ?? 0} days)` : ''));
    const stage = t === 'lead_stage' ? ' Stages: ' + LOOKUPS.filter((l) => l.type === t).map((l) => `${l.value} counts as ${l.meta?.kind}`).join('; ') + '.' : '';
    return { id: `list-${t}`, title: `${label} (pick-list)`, keywords: `${pretty(t)} list options choices dropdown categories`, text: `${about} Default values: ${list(vals)}.${stage} You can add, rename or hide values in Settings > Categories & Lists${t === 'lead_stage' ? ' or Settings > Lead Stages' : ''}.`, source: 'Pick-lists' };
  });
}

function accountDocs() {
  const out = [];
  for (const [type, label] of Object.entries(ACCOUNT_GROUPS)) {
    const names = COA.filter((a) => a[2] === type && a[4]).map((a) => `${a[1]} (${a[0]})`);
    out.push({ id: `coa-${type}`, title: `Chart of accounts: ${label}`, keywords: `chart of accounts ledger account code ${label}`, text: `${label} accounts that come with every workspace: ${list(names)}. See Accounting > Chart of Accounts.`, source: 'Accounting' });
  }
  return out;
}

function regionDocs() {
  const out = [];
  for (const [code, p] of Object.entries(FILE_PACKS)) {
    const flags = Object.entries(p.flags || {}).filter(([, v]) => v).map(([k]) => `${k}: ${FLAG_NOTES[k].replace(/\.$/, '')}`);
    const types = [...new Set((p.property_types || []).map((t) => t.label))];
    out.push({ id: `region-${code}`, title: `Regional settings for ${p.name}`, keywords: `region country ${p.name} ${code} ${(COUNTRIES[code]?.words || []).join(' ')} currency units terminology options settings workspace`,
      text: `${p.name} workspaces use ${p.currency}, ${p.units_system === 'imperial' ? 'imperial' : 'mixed'} units${p.default_area_unit ? ` with ${p.default_area_unit} as the default area unit` : ''}${p.sub_region_label ? `, and choose ${/^[aeiou]/i.test(p.sub_region_label) ? 'an' : 'a'} ${p.sub_region_label.toLowerCase()}` : ''}. ${flags.length ? `Switched on: ${flags.join('; ')}.` : 'No optional regional modules.'} ${types.length ? `Property types include ${list(types.slice(0, 10))}.` : ''} ${p.lead_sources ? `Lead sources include ${list(p.lead_sources.slice(0, 8))}.` : ''}`.replace(/\s+/g, ' ').trim(), source: 'Regions' });
  }
  return out;
}

function workflowDocs() {
  return WORKFLOWS.map((w) => ({ id: `wf-${w.key}`, title: w.title, keywords: w.keywords, text: w.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') + (w.notes ? `\n${w.notes}` : ''), source: 'Workflow', workflow: true }));
}

let cache;
/** Every system-knowledge document, built once from the code. */
export function systemDocs() {
  return (cache ||= [...workflowDocs(), ...roleDocs(), ...settingDocs(), ...listDocs(), ...accountDocs(), ...regionDocs()]);
}
