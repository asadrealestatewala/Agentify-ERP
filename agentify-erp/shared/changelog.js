// The single source of truth for the product version and the "What's new" page.
// Version key: vMAJOR.MINOR. Every shipped update adds an entry at the TOP and the version goes up by one minor
// step (v1.0 -> v1.1 -> v1.2). A big release moves to the next major (v2.0). The app version is the first entry.
// Write for customers: plain words, what changed and where to find it. See "Releases and versions" in CLAUDE.md.
export const CHANGELOG = [
  {
    version: 'v1.11', date: '2026-10-26', title: "What's new page and version numbers",
    items: [
      { text: "A What's new page lists every update with its version number. The current version is shown at the bottom of the menu.", where: "Menu > What's new" },
    ],
  },
  {
    version: 'v1.10', date: '2026-10-26', title: 'Cleaner customer and vendor sign-in',
    items: [
      { text: 'The demo customer and vendor hints on the portal sign-in pages now appear only in demo workspaces.', where: 'Customer and vendor portal sign-in' },
    ],
  },
  {
    version: 'v1.9', date: '2026-10-26', title: 'Company-branded staff sign-in',
    items: [
      { text: "Your workspace sign-in page shows your own company name and logo, without Agentify marketing.", where: 'Workspace sign-in page' },
      { text: 'There is no staff door on your public website. Staff use a private link that you can change.', where: 'Settings > System Settings' },
    ],
  },
  {
    version: 'v1.8', date: '2026-10-26', title: 'Sign in menu on your website',
    items: [
      { text: 'Your website header and footer can show a Sign in menu for staff, customers and vendors. You can switch it on or off.', where: 'Website > Website Editor' },
    ],
  },
  {
    version: 'v1.7', date: '2026-10-26', title: 'Offline work stays with the right person',
    items: [
      { text: 'Actions saved while you are offline are now tied to your user and workspace, and are sent only when you are signed back in.', where: 'Works across the app' },
    ],
  },
  {
    version: 'v1.6', date: '2026-10-26', title: 'Field agent location sharing',
    items: [
      { text: 'Field agents can choose to share their location while working. Managers see a coverage view. It is off until an admin switches it on, and employees see a consent notice first.', where: 'My Space > My Location, Field Coverage' },
    ],
  },
  {
    version: 'v1.5', date: '2026-10-26', title: 'Property visits',
    items: [
      { text: 'Check in and out of property visits, record the outcome, set follow-ups and get reminders.', where: 'Properties and the property page' },
    ],
  },
  {
    version: 'v1.4', date: '2026-10-26', title: 'Employee onboarding checklists',
    items: [
      { text: 'HR can build onboarding checklists for new employees and follow their progress. Employees see their own list.', where: 'HRM > Onboarding, My Space > My Onboarding' },
      { text: 'A working calendar lets each workspace choose its weekend.', where: 'Settings > System Settings' },
    ],
  },
  {
    version: 'v1.3', date: '2026-10-26', title: 'AI writer for property ads',
    items: [
      { text: 'Write a property title and description from the facts you entered. You review the text before it is used.', where: 'Properties > Add Property > Ad information' },
    ],
  },
  {
    version: 'v1.2', date: '2026-10-25', title: 'Sharper icons on your website',
    items: [
      { text: 'Website sections now use a clean, consistent icon set instead of emoji. You can pick icons in the website editor.', where: 'Website > Website Editor' },
    ],
  },
  {
    version: 'v1.1', date: '2026-10-25', title: 'New website themes',
    items: [
      { text: 'Two new website themes with sample pages: Horizon Luxury and Urban Living.', where: 'Website > Website Editor > Themes' },
    ],
  },
  {
    version: 'v1.0', date: '2026-10-24', title: 'Recordings filters and branded emails',
    items: [
      { text: 'Find call recordings by keyword (including the transcript), customer, host or agent, date, time of day, transcript state and minimum length.', where: 'Recordings' },
      { text: 'Emails from your workspace carry your own company details. Emails from Agentify carry the Agentify look.', where: 'Works across the app' },
    ],
  },
];

export const APP_VERSION = CHANGELOG[0].version;
