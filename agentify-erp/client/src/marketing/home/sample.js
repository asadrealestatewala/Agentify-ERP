// Sample data for the landing page's product previews. Every record here is invented, fixed (the same on every visit) and
// shown with a "Sample data" label. Nothing is read from or written to any workspace. Phone numbers are masked and
// e-mail addresses use the reserved example.com domain.

// The default lead stages of a new workspace (each workspace can rename or add its own in Settings).
export const STAGES = [
  { key: 'new', label: 'Non Contacted', tone: 'slate' },
  { key: 'contacted', label: 'Contacted', tone: 'blue' },
  { key: 'follow', label: 'Follow Up', tone: 'amber' },
  { key: 'interested', label: 'Interested', tone: 'green' },
  { key: 'closed', label: 'Closed', tone: 'won' },
  { key: 'lost', label: 'Not Interested', tone: 'red' },
];
export const SOURCES = ['Website', 'Portal', 'Referral', 'Walk-in', 'Facebook', 'Phone call'];
export const AGENTS = [
  { id: 'a1', name: 'Sara Malik', initials: 'SM' },
  { id: 'a2', name: 'James Carter', initials: 'JC' },
  { id: 'a3', name: 'Nadia Rahman', initials: 'NR' },
];

// Amounts are written in one base unit and shown in the visitor's currency with a rough, rounded factor, so the sample
// looks local. They are illustrations, not prices.
const FACTOR = { USD: 1, CAD: 1.35, GBP: 0.8, AED: 3.67, PKR: 280 };
export function sampleMoney(base, currency) {
  const f = FACTOR[currency] ?? 1, cur = FACTOR[currency] ? currency : 'USD';
  const v = base * f;
  const step = v >= 1e7 ? 1e5 : v >= 1e6 ? 1e4 : 1e3;
  return new Intl.NumberFormat('en', { style: 'currency', currency: cur, maximumFractionDigits: 0, notation: v >= 1e7 ? 'compact' : 'standard' }).format(Math.round(v / step) * step);
}

export const LEADS = [
  { id: 'l1', name: 'Amelia Grant', source: 'Website', stage: 'new', agent: 'a1', priority: 'High', budget: 420000, area: 'Marina district', type: 'Apartment', beds: 2, timeline: 'Within 3 months', next: 'Call back today, 4:00 pm', received: '9 min ago', phone: '•••• •• 0142', email: 'amelia.g@example.com', property: 'p1' },
  { id: 'l2', name: 'Omar Haddad', source: 'Portal', stage: 'contacted', agent: 'a2', priority: 'Medium', budget: 650000, area: 'Hillside', type: 'Villa', beds: 4, timeline: 'This year', next: 'Send floor plans', received: '1 h ago', phone: '•••• •• 0177', email: 'omar.h@example.com', property: 'p3' },
  { id: 'l3', name: 'Priya Shah', source: 'Referral', stage: 'follow', agent: 'a1', priority: 'High', budget: 310000, area: 'Old Town', type: 'Apartment', beds: 1, timeline: 'Within 1 month', next: 'Viewing on Thursday', received: 'Yesterday', phone: '•••• •• 0105', email: 'priya.s@example.com', property: 'p2' },
  { id: 'l4', name: 'Daniel Brooks', source: 'Facebook', stage: 'new', agent: 'a3', priority: 'Medium', budget: 280000, area: 'Riverside', type: 'Townhouse', beds: 3, timeline: 'Just browsing', next: 'First call', received: '3 h ago', phone: '•••• •• 0161', email: 'daniel.b@example.com', property: 'p4' },
  { id: 'l5', name: 'Hana Yusuf', source: 'Walk-in', stage: 'interested', agent: 'a2', priority: 'High', budget: 900000, area: 'Hillside', type: 'Villa', beds: 5, timeline: 'Within 3 months', next: 'Prepare offer', received: '2 days ago', phone: '•••• •• 0129', email: 'hana.y@example.com', property: 'p3' },
  { id: 'l6', name: 'Lucas Moreau', source: 'Website', stage: 'contacted', agent: 'a3', priority: 'Low', budget: 360000, area: 'Marina district', type: 'Apartment', beds: 2, timeline: 'Next year', next: 'Share new listings', received: '2 days ago', phone: '•••• •• 0193', email: 'lucas.m@example.com', property: 'p1' },
  { id: 'l7', name: 'Grace Okafor', source: 'Phone call', stage: 'closed', agent: 'a1', priority: 'Medium', budget: 300000, area: 'Old Town', type: 'Apartment', beds: 2, timeline: 'Done', next: 'Handover documents', received: 'Last week', phone: '•••• •• 0118', email: 'grace.o@example.com', property: 'p2' },
  { id: 'l8', name: 'Ethan Ward', source: 'Portal', stage: 'lost', agent: 'a2', priority: 'Low', budget: 250000, area: 'Riverside', type: 'Townhouse', beds: 3, timeline: 'Chose another area', next: '—', received: 'Last week', phone: '•••• •• 0150', email: 'ethan.w@example.com', property: 'p4' },
];

export const PROPERTIES = [
  { id: 'p1', title: '2-bed apartment, sea view', area: 'Marina district', price: 410000, beds: 2, baths: 2, size: 1150, status: 'For sale', tone: 'blue' },
  { id: 'p2', title: '1-bed apartment near the square', area: 'Old Town', price: 305000, beds: 1, baths: 1, size: 720, status: 'Reserved', tone: 'amber' },
  { id: 'p3', title: '4-bed villa with garden', area: 'Hillside', price: 880000, beds: 4, baths: 4, size: 3400, status: 'For sale', tone: 'blue' },
  { id: 'p4', title: '3-bed townhouse by the park', area: 'Riverside', price: 275000, beds: 3, baths: 2, size: 1600, status: 'Sold', tone: 'green' },
];

export const TASKS = [
  { id: 't1', title: 'Call back Amelia Grant', lead: 'l1', agent: 'a1', due: 'overdue', when: 'Due yesterday', kind: 'Call' },
  { id: 't2', title: 'Send floor plans to Omar Haddad', lead: 'l2', agent: 'a2', due: 'today', when: 'Today, 11:00', kind: 'Email' },
  { id: 't3', title: 'Viewing with Priya Shah', lead: 'l3', agent: 'a1', due: 'today', when: 'Today, 16:30', kind: 'Viewing' },
  { id: 't4', title: 'First call to Daniel Brooks', lead: 'l4', agent: 'a3', due: 'overdue', when: 'Due 2 days ago', kind: 'Call' },
  { id: 't5', title: 'Prepare offer for Hana Yusuf', lead: 'l5', agent: 'a2', due: 'upcoming', when: 'Tomorrow', kind: 'Task' },
  { id: 't6', title: 'Share new listings with Lucas Moreau', lead: 'l6', agent: 'a3', due: 'upcoming', when: 'Friday', kind: 'Message' },
];

export const TIMELINE = [
  { at: 'Today 09:12', text: 'Enquiry received from the website about “2-bed apartment, sea view”' },
  { at: 'Today 09:12', text: 'Assigned to Sara Malik (the listing’s agent)' },
  { at: 'Today 09:40', text: 'Call made, 4 min. Outcome: asked for a call back' },
  { at: 'Today 09:41', text: 'Follow-up set for today, 4:00 pm' },
];

// Team view: two periods so the toggle has something real to switch between.
export const TEAM = {
  this: [{ agent: 'a1', leads: 24, done: 0.86, value: 1450000 }, { agent: 'a2', leads: 19, done: 0.74, value: 1820000 }, { agent: 'a3', leads: 15, done: 0.61, value: 640000 }],
  last: [{ agent: 'a1', leads: 21, done: 0.79, value: 1210000 }, { agent: 'a2', leads: 22, done: 0.81, value: 1500000 }, { agent: 'a3', leads: 12, done: 0.55, value: 520000 }],
};

export const agentName = (id) => AGENTS.find((a) => a.id === id)?.name || '';
export const agentInitials = (id) => AGENTS.find((a) => a.id === id)?.initials || '';
export const leadById = (id) => LEADS.find((l) => l.id === id);
export const propertyById = (id) => PROPERTIES.find((p) => p.id === id);
export const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
