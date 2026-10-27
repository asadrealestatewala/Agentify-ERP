// The single source of truth for the product version and the "What's new" page.
// Version key: vMAJOR.MINOR. Every shipped update adds an entry at the TOP and the version goes up by one minor
// step (v1.0 -> v1.1 -> v1.2). A big release moves to the next major (v2.0). The app version is the first entry.
// Items are for the workspace (tenant) by default. Mark platform-only items (Super Admin console, integrations keys,
// billing/inbox operations) with `audience: 'platform'`; they never show in a workspace. See "What's new audiences" in CLAUDE.md.
// Write for customers: plain words, what changed and where to find it. See "Releases and versions" in CLAUDE.md.
export const CHANGELOG = [
  {
    version: 'v1.44', date: '2026-10-27', title: 'Your own colour and logo',
    items: [
      { text: 'Choose your workspace brand colour and upload your logo. The colour replaces the default on buttons, links and highlights, and the logo appears at the top left of the menu. Colours that make white text hard to read are refused. Leave both empty to keep the default look.', where: 'Settings > Receipts & Branding > Workspace colour & logo' },
    ],
  },
  {
    version: 'v1.43', date: '2026-10-27', title: 'Download a training video from the console',
    items: [
      { text: 'Console > Training videos has a Download MP4 button on every video that still has a server copy, so you can upload it to YouTube by hand and then link it.', audience: 'platform' },
    ],
  },
  {
    version: 'v1.42', date: '2026-10-27', title: 'See which YouTube channel training videos go to',
    items: [
      { text: 'After connecting YouTube the page shows the channel uploads will go to, and you can save an expected channel ID so posting is refused if the wrong channel is connected. A video uploaded by hand in YouTube Studio can be linked with its YouTube address.', audience: 'platform', where: 'Console > System > Training videos' },
    ],
  },
  {
    version: 'v1.41', date: '2026-10-27', title: 'Choose the YouTube channel and re-post training videos',
    items: [
      { text: 'Connecting YouTube now always asks which account and channel to use (so a brand channel can be chosen), each posted video shows the channel it went to, and Unlink from YouTube lets you forget a link and post the video again.', audience: 'platform', where: 'Console > System > Training videos' },
    ],
  },
  {
    version: 'v1.40', date: '2026-10-27', title: 'Training videos open on YouTube',
    items: [
      { text: 'Training videos can now open on YouTube. Where a video shows Watch on YouTube, it opens in a new tab with the title and description shown here, and loads faster because nothing is downloaded from Agentify. The two Field Coverage videos move there first.', where: 'Training Videos' },
      { text: 'New Training videos page: post each video to your YouTube channel (unlisted, public or private) and every workspace then shows the YouTube link with the title and description saved here. Reports "not configured" until the Google client and a YouTube channel are connected, and the server copy of a posted video can be deleted.', audience: 'platform', where: 'Console > System > Training videos' },
    ],
  },
  {
    version: 'v1.39', date: '2026-10-27', title: 'Training videos for field coverage',
    items: [
      { text: 'Two new training videos: one for administrators and HR on setting up and reading field coverage, and one for field staff on agreeing to the notice, sharing their location only when they choose, and stopping.', where: 'Training Videos' },
    ],
  },
  {
    version: 'v1.38', date: '2026-10-27', title: 'The Android app now updates itself from the website',
    items: [
      { text: 'Colours of the status bar, Back behaviour and the in-app update notice are now controlled from the website, so the Android app improves without anyone reinstalling it. Only a rare change to the app file itself asks you to install a new one, and the app tells you when.', where: 'Android app' },
      { text: 'New Mobile app page: set the status bar and bottom bar colours for light and dark mode, the recent-apps title, safe-area handling, and an optional update banner or minimum version.', audience: 'platform', where: 'Console > System > Mobile app' },
    ],
  },
  {
    version: 'v1.37', date: '2026-10-27', title: 'Cleaner phone screens and a Back button that steps back',
    items: [
      { text: 'On phones the tables become one card per row, so nothing is cut off or blank when you scroll sideways. Report lists no longer push the table off screen.', where: 'Reports, Commissions, Leads and other lists on a phone' },
      { text: 'The floating Ask button no longer covers Cancel, Save or fields. Ask now sits in the top bar, and every page ends clear of the bottom tabs.', where: 'Top bar, on phones' },
      { text: 'The Back button closes an open menu, notifications or Ask panel first, then goes to the previous screen, and only leaves the app from the home screen. The Android app needs the updated app file for this and for the status bar fix.', where: 'Phones and the Android app' },
      { text: 'Contact page: the duplicate vertical icon strip is hidden on phones, and the menu drawer is more compact.', where: 'Contacts, menu on phones' },
    ],
  },
  {
    version: 'v1.36', date: '2026-10-27', title: 'Account statement, receipt PDFs and payment history in Plan & Billing',
    items: [
      { text: 'Download an account statement as PDF or Excel (CSV) for any date range, with every charge, payment and refund and a running balance.', where: 'Settings > Plan & Billing > Account statement' },
      { text: 'Every invoice now has a receipt PDF, whether you paid by card, bank transfer, wallet or an online gateway.', where: 'Settings > Plan & Billing > Invoices & receipts' },
      { text: 'See all your payments in one list, including ones waiting for confirmation and ones we could not accept, with the reason.', where: 'Settings > Plan & Billing > Payment history' },
      { text: 'When you pay by bank or wallet transfer you can attach a photo or PDF of your payment receipt (up to 5 MB) so we can confirm it faster. You can add or replace it while the payment is waiting.', where: 'Settings > Plan & Billing > Pay' },
    ],
  },
  {
    version: 'v1.35', date: '2026-10-27', title: "What's new now shows each audience only its own updates",
    items: [
      { text: "Workspaces see only updates that concern their own work; console administration updates appear only here, in the console What's new and Alerts. A version with nothing for workspaces sends them no notification.", audience: 'platform', where: "Super Admin console > Dashboard > What's new" },
    ],
  },
  {
    version: 'v1.34', date: '2026-10-27', title: 'WhatsApp templates: start a chat or write after 24 hours',
    items: [
      { text: 'WhatsApp only lets a business start a chat, or write again after 24 hours of silence, with a template WhatsApp has approved. You can now list the templates from your Botlinkd account, and send one to one person from the inbox (New chat with a template, or Send a template when the window is closed). Limits, do-not-message blocks and the consent tick still apply.', where: 'Settings > WhatsApp > Message templates, and the WhatsApp inbox' },
      { text: 'The console WhatsApp test can now send an approved template, and explains that "customer service window is closed" means the keys work but a template is needed.', audience: 'platform', where: 'Super Admin console > Integrations > WhatsApp (Botlinkd) > Change keys' },
    ],
  },
  {
    version: 'v1.33', date: '2026-10-26', title: 'Clearer place to add the WhatsApp keys',
    items: [
      { text: 'The WhatsApp (Botlinkd) and QR gateway cards now have a highlighted "Add keys" button, and tell you plainly when your console role cannot change integrations.', audience: 'platform', where: 'Super Admin console > Integrations' },
    ],
  },
  {
    version: 'v1.32', date: '2026-10-26', title: 'Failed-payment emails, and all billing mail from billing@agentifyerp.co',
    items: [
      { text: 'If a card payment fails, the owner gets one email saying so, with the date they keep access until and a button to fix it. Payment reminders, renewal and trial notices and failed-payment emails all come from billing@agentifyerp.co, and end with where to ask a question.', where: 'Your inbox' },
    ],
  },
  {
    version: 'v1.31', date: '2026-10-26', title: 'Payment receipts by email from billing@agentifyerp.co',
    items: [
      { text: 'Every time a payment is recorded for your workspace (card, bank or wallet transfer) you get one email titled "Payment received successfully" with the amount, plan, date and reference. Billing emails now come from billing@agentifyerp.co, and you can reply or write there with any billing question.', where: 'Your inbox' },
      { text: 'The Agentify administrator can see every receipt sent, send one again, and read and answer billing mail.', audience: 'platform', where: 'Super Admin console > Billing & Payments > Billing mail & receipts' },
    ],
  },
  {
    version: 'v1.30', date: '2026-10-26', title: 'Warning when someone keeps guessing your password, and a list of where you signed in',
    items: [
      { text: 'If there are 5 wrong password attempts on your account within 15 minutes, you get an email with the address they came from, and a button to reset your password. You get at most one such email an hour.', where: 'Your inbox' },
      { text: 'See the browsers and addresses your account has signed in from, and sign out of every other device in one click.', where: 'My Space > Security > Where you have signed in' },
    ],
  },
  {
    version: 'v1.29', date: '2026-10-26', title: 'Email codes, new sign-in alerts and no more throw-away emails',
    items: [
      { text: 'Creating a workspace now needs a 6-digit code we email to the owner, so only a real mailbox the person can read can start a workspace. Temporary and disposable email services, and domains that cannot receive mail, are refused.', where: 'Sign-up page' },
      { text: 'Administrators can ask for an emailed code after the password: for every sign-in, or only when someone signs in from a new browser. People who use an authenticator app keep using that.', where: 'My Space > Security > Email sign-in code' },
      { text: 'When your account is signed in from an address and browser we have not seen before, you get an email with the time, address and browser, and a button to change your password.', where: 'Your inbox' },
      { text: 'Staff invitations and users added by an administrator also refuse disposable email addresses.', where: 'Settings > Users' },
      { text: 'The Agentify administrator can switch each rule on or off, add their own blocked domains, allow a domain the list gets wrong, and try an address to see if it would be accepted.', audience: 'platform', where: 'Super Admin console > Security & Access > Email safety' },
    ],
  },
  {
    version: 'v1.28', date: '2026-10-26', title: 'Optional QR connection for WhatsApp',
    items: [
      { text: 'Where your plan allows it, you can link a number by scanning a QR code instead of the official connection. It is unofficial, so WhatsApp can ban the number; you must tick a warning to switch it on, and you can switch it off any time.', where: 'Settings > WhatsApp > QR connection' },
    ],
  },
  {
    version: 'v1.27', date: '2026-10-26', title: 'New versions now announce themselves in your notifications',
    items: [
      { text: 'Whenever Agentify ERP gets a new feature for you, everyone on your team gets one notification in the bell with a link to What\'s new, so nobody misses a new feature. It appears once per version and stays until you read it.', where: 'Notifications (bell); Menu > What\'s new' },
      { text: 'Console users get the same notice, with its own read state for each person.', audience: 'platform', where: 'Super Admin console > Alerts' },
    ],
  },
  {
    version: 'v1.26', date: '2026-10-26', title: 'Property map shows the street map again',
    items: [
      { text: 'Fixed the property map showing "Access blocked" instead of the street map. Matches for a typed location are now a clean list, one per line, with repeats merged.', where: 'Properties > Add or edit property > Location' },
    ],
  },
  {
    version: 'v1.25', date: '2026-10-26', title: 'Android app download is live',
    items: [
      { text: 'The Android app (APK) is rebuilt for current Android versions and ready to download from the Download app buttons on the website and in your workspace. This is a test build for installing directly on a phone; the Google Play version comes later.', where: 'Download app' },
    ],
  },
  {
    version: 'v1.24', date: '2026-10-26', title: 'WhatsApp inbox for your customers\' chats',
    items: [
      { text: 'Connect your own WhatsApp Business number through your Botlinkd account (official WhatsApp Cloud API) and read and answer customer chats next to their CRM record. Chats are matched to contacts by phone number, can be assigned to an agent, closed, or turned into a lead.', where: 'WhatsApp; Settings > WhatsApp' },
      { text: 'Built to protect your number: replies are one-to-one and possible for 24 hours after the customer\'s last message, there is no bulk sending, STOP and similar words block a customer until they write START, and each person and each day and month is capped.', where: 'WhatsApp' },
      { text: 'Available when your plan includes it.', where: 'Settings > WhatsApp' },
    ],
  },
  {
    version: 'v1.23', date: '2026-10-26', title: 'Android app for Google Play, privacy policy and account deletion',
    items: [
      { text: 'Paying workspaces can download the Android app (Google Play when it is live, or the direct file) from the Download app button and the Install the app page. The public website has a Download our app page too.', where: 'My Space > Install the app; website footer' },
      { text: 'A full draft Privacy Policy that covers the apps, and a public Delete your account page that works without signing in.', where: 'Website footer > Legal; /delete-account' },
      { text: 'Inside the Android app, subscriptions are not sold: Plan & Billing shows your plan and the account closure request, and buying or changing a plan happens on the website.', where: 'Android app > Plan & Billing' },
      { text: 'The Super Admin can paste the Google Play link once the listing exists, and the buttons appear everywhere at once.', audience: 'platform', where: 'Super Admin console > Website builder > Mobile app' },
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
      { text: 'Two new tables show how much email each plan and each workspace has used against its allowance in the current period, with warning and used-up markers.', audience: 'platform', where: 'Super Admin console > Mailbox > Tenant email' },
    ],
  },
  {
    version: 'v1.18', date: '2026-10-26', title: 'Tenant email page opens again',
    items: [
      { text: 'Fixed the Tenant email page showing a blank screen after the last update, so the Resend connection tools (test, webhook, test email) work again.', audience: 'platform', where: 'Super Admin console > Mailbox > Tenant email' },
    ],
  },
  {
    version: 'v1.17', date: '2026-10-26', title: 'Resend setup reuses what you already have',
    items: [
      { text: 'Registering the Resend webhook now finds one already at your address and uses it instead of making a second. Missing events are added and your own extra events are kept, and the panel says which of the three happened.', audience: 'platform', where: 'Super Admin console > Tenant email > Resend connection' },
      { text: 'Save the webhook signing secret straight from the panel if Resend does not hand it over. It is stored encrypted and never shown again; you can rotate it in Resend first.', audience: 'platform', where: 'Super Admin console > Tenant email > Resend connection' },
      { text: 'Domains you already verified at Resend are listed with sending and receiving status and are never re-created. Reply detection stays off until you choose the reply address.', audience: 'platform', where: 'Super Admin console > Tenant email' },
    ],
  },
  {
    version: 'v1.16', date: '2026-10-26', title: 'Connect Resend from the console',
    items: [
      { text: 'Super Admins can test the Resend connection (domains, webhooks, usage), register the delivery webhook in one click, and send a test email to themselves. The API key stays encrypted and is never shown.', audience: 'platform', where: 'Super Admin console > Tenant email' },
      { text: 'The plan list now shows each plan\'s monthly email allowance, warning points and stop behaviour at a glance. Nothing is preset: a plan with no allowance cannot send tenant email.', audience: 'platform', where: 'Super Admin console > Plans' },
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
      { text: "The Super Admin console has the same What's new page and shows the current version.", audience: 'platform', where: "Super Admin console > Dashboard > What's new" },
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

/** Items a workspace user may see. Releases with none are dropped. */
export const tenantChangelog = (log = CHANGELOG) => log
  .map((r) => ({ ...r, items: r.items.filter((i) => i.audience !== 'platform') }))
  .filter((r) => r.items.length);
