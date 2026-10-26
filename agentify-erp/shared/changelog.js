// The single source of truth for the product version and the "What's new" page.
// Version key: vMAJOR.MINOR. Every shipped update adds an entry at the TOP and the version goes up by one minor
// step (v1.0 -> v1.1 -> v1.2). A big release moves to the next major (v2.0). The app version is the first entry.
// Write for customers: plain words, what changed and where to find it. See "Releases and versions" in CLAUDE.md.
export const CHANGELOG = [
  {
    version: 'v1.24', date: '2026-10-26', title: 'WhatsApp inbox for your customers\' chats',
    items: [
      { text: 'Connect your own WhatsApp Business number through your Botlinkd account (official WhatsApp Cloud API) and read and answer customer chats next to their CRM record. Chats are matched to contacts by phone number, can be assigned to an agent, closed, or turned into a lead.', where: 'WhatsApp; Settings > WhatsApp' },
      { text: 'Built to protect your number: replies are one-to-one and possible for 24 hours after the customer\'s last message, there is no bulk sending, STOP and similar words block a customer until they write START, and each person and each day and month is capped.', where: 'WhatsApp' },
      { text: 'Available when your plan includes it. Your Agentify administrator switches WhatsApp on per plan or per workspace.', where: 'Settings > WhatsApp' },
    ],
  },
  {
    version: 'v1.23', date: '2026-10-26', title: 'Android app for Google Play, privacy policy and account deletion',
    items: [
      { text: 'Paying workspaces can download the Android app (Google Play when it is live, or the direct file) from the Download app button and the Install the app page. The public website has a Download our app page too.', where: 'My Space > Install the app; website footer' },
      { text: 'A full draft Privacy Policy that covers the apps, and a public Delete your account page that works without signing in.', where: 'Website footer > Legal; /delete-account' },
      { text: 'Inside the Android app, subscriptions are not sold: Plan & Billing shows your plan and the account closure request, and buying or changing a plan happens on the website.', where: 'Android app > Plan & Billing' },
      { text: 'The Super Admin can paste the Google Play link once the listing exists, and the buttons appear everywhere at once.', where: 'Super Admin console > Website builder > Mobile app' },
    ],
  },
  {
    version: 'v1.22', date: '2026-10-26', title: 'Street-level location search and a draggable map pin',
    items: [
      { text: 'Location search now narrows down to the street or colony: it finds the city or area first, then looks for each street or colony you typed inside it, whichever box you typed it in, and also tries common alternate spellings. The search shows several matches you can click, in English, marked as street or area.', where: 'Properties > Add or edit property > Location' },
      { text: 'The map is now an interactive map: drag the pin (or click the map) to the exact spot and the GPS latitude and longitude update. The "approximate" warning only appears when the street really could not be found.', where: 'Properties > Add or edit property > Location' },
    ],
  },
  {
    version: 'v1.21', date: '2026-10-26', title: 'Latitude, longitude and map fill in as you type',
    items: [
      { text: 'As you type the City, Area, Location and Address, the map finds the place and drops the pin on it, and the GPS latitude and longitude fill in by themselves. Find on map does it on demand, other matches are offered, and you are told when nothing is found. Coordinates you typed yourself are never replaced automatically.', where: 'Properties > Add or edit property > Location' },
    ],
  },
  {
    version: 'v1.20', date: '2026-10-26', title: 'Tidier Lead conversion tables',
    items: [
      { text: 'The By source and By owner tables now have a header row and aligned columns for Leads, Responded, Appointment and Won. Each rate shows the percentage with the count underneath, and "No data" when there is nothing to measure yet.', where: 'CRM > Lead Conversion' },
    ],
  },
  {
    version: 'v1.19', date: '2026-10-26', title: 'See email use by plan and workspace',
    items: [
      { text: 'Two new tables show how much email each plan and each workspace has used against its allowance in the current period, with warning and used-up markers.', where: 'Super Admin console > Mailbox > Tenant email' },
    ],
  },
  {
    version: 'v1.18', date: '2026-10-26', title: 'Tenant email page opens again',
    items: [
      { text: 'Fixed the Tenant email page showing a blank screen after the last update, so the Resend connection tools (test, webhook, test email) work again.', where: 'Super Admin console > Mailbox > Tenant email' },
    ],
  },
  {
    version: 'v1.17', date: '2026-10-26', title: 'Resend setup reuses what you already have',
    items: [
      { text: 'Registering the Resend webhook now finds one already at your address and uses it instead of making a second. Missing events are added and your own extra events are kept, and the panel says which of the three happened.', where: 'Super Admin console > Tenant email > Resend connection' },
      { text: 'Save the webhook signing secret straight from the panel if Resend does not hand it over. It is stored encrypted and never shown again; you can rotate it in Resend first.', where: 'Super Admin console > Tenant email > Resend connection' },
      { text: 'Domains you already verified at Resend are listed with sending and receiving status and are never re-created. Reply detection stays off until you choose the reply address.', where: 'Super Admin console > Tenant email' },
    ],
  },
  {
    version: 'v1.16', date: '2026-10-26', title: 'Connect Resend from the console',
    items: [
      { text: 'Super Admins can test the Resend connection (domains, webhooks, usage), register the delivery webhook in one click, and send a test email to themselves. The API key stays encrypted and is never shown.', where: 'Super Admin console > Tenant email' },
      { text: 'The plan list now shows each plan\'s monthly email allowance, warning points and stop behaviour at a glance. Nothing is preset: a plan with no allowance cannot send tenant email.', where: 'Super Admin console > Plans' },
    ],
  },
  {
    version: 'v1.15', date: '2026-10-26', title: 'Faster, fairer lead follow-up',
    items: [
      { text: 'Share new leads between your agents by rules (take turns, weighted, by source, city or team), skip agents who are away or full, and see why each lead went to its owner. Existing leads never move when you change a rule.', where: 'Settings > Lead Routing' },
      { text: 'Set how fast an owner must accept and personally answer a new lead, using your working hours and holidays. Reminders, a manager alert and an optional reassignment follow only when a target is missed. Automated emails never count as a response.', where: 'Settings > Lead Routing' },
      { text: 'Repeated enquiries are recorded once, and two different people who share a phone number are kept apart for a manager to review before anything is merged.', where: 'Settings > Lead Routing > Duplicates' },
      { text: 'Build follow-up sequences of emails and tasks from ready templates. They stop when the customer replies, books a viewing, opts out or the lead closes, and wait if there is no verified sender or allowance.', where: 'CRM > Follow-up Sequences' },
      { text: 'See how leads convert from enquiry to response, viewing and sale, with the numbers each percentage is based on.', where: 'CRM > Lead Conversion' },
    ],
  },
  {
    version: 'v1.14', date: '2026-10-26', title: 'Send email from your own address',
    items: [
      { text: 'Verify your company domain and create sender addresses so appointment reminders and follow-ups come from you. Only verified addresses can send.', where: 'Settings > Email' },
      { text: 'See your monthly email allowance, what is used and waiting, when it resets, and the delivery status of every message. Unsubscribes, bounces and complaints are respected automatically.', where: 'Settings > Email' },
      { text: 'A setup checklist on the dashboard ticks itself as you add your business details, first lead, team and follow-up, and Agentify sends a few helpful setup tips by email (you can switch them off).', where: 'Dashboard' },
    ],
  },
  {
    version: 'v1.13', date: '2026-10-26', title: 'Online payments for your customers',
    items: [
      { text: 'Connect your own Stripe, PayPal or Tap account so customers can pay installments online from their portal. Receipts are created automatically once the payment is confirmed. Start in test mode.', where: 'Settings > Payment Gateways' },
      { text: 'Bank accounts and wallets still work: customers pay, upload the slip, and your team confirms.', where: 'Settings > Payment Methods' },
    ],
  },
  {
    version: 'v1.12', date: '2026-10-26', title: "What's new in the Super Admin console",
    items: [
      { text: "The Super Admin console has the same What's new page and shows the current version.", where: "Super Admin console > Dashboard > What's new" },
    ],
  },
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
