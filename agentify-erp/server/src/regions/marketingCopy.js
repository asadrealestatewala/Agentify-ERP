// Country-specific wording for the global marketing site (headline, sub-headline, highlights, extra FAQs, calculator strip).
// Defaults live here until a console editor exists; the factual claims are limited to what the product actually does.
/** Shown when the visitor's country is unknown or not one of the markets below. */
export const GLOBAL_CRM_COPY = { hook: 'Every real estate lead. Every follow-up. One CRM.', sub: 'Manage enquiries, client relationships, property interests and deals from one workspace, so your team knows who to contact, what happens next and where every opportunity stands.', emphasis: ['Website enquiries become leads', 'Follow-up reminders', 'Pipeline by stage'] };

export const COUNTRY_COPY = {
  US: {
    slug: 'us', flag: '🇺🇸',
    // CRM-first headline for this market; {city} is filled only for the listed cities (no local office or customer is implied)
    crm: { hook: 'Every lead, showing and closing in one CRM.', sub: 'Manage enquiries, buyers and sellers, property interests and deals from one workspace, so your team knows who to contact, what happens next and where every opportunity stands.', city_hook: 'One CRM for your real estate team in {city}.', cities: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Dallas', 'Austin', 'Miami', 'Atlanta', 'Seattle', 'Denver', 'Boston'], emphasis: ['Showings in Google Calendar', 'Commission splits', 'Listing feeds for portals'] },
    works_with: ['Listing feeds for Zillow and Trulia', 'MLS (RESO Web API)', 'Realtor.com', 'Twilio calling and texting', 'Google Calendar', 'Facebook, Instagram, LinkedIn and TikTok', 'Your own domain'],
    calls: 'Calls and texts run through your own Twilio account.',
    hero_title: 'Run your brokerage and your builds from one system',
    hero_subtitle: 'Leads, listings, transactions and commission splits for agents and brokers, plus estimates, change orders and subcontractor tracking for builders. Priced in US dollars, measured in square feet.',
    chips: ['Transaction checklists', 'Commission splits', 'Mortgage referral tracking', 'Sq ft and acres', 'Two-factor sign-in'],
    calc_title: 'Try the numbers for the United States', calc_sub: 'A mortgage payment with taxes, insurance and HOA, and estimated closing costs. Estimates only.',
    faqs: [['Do you cover townhouses, condos and multi-family?', 'Yes. Listings use US property types: single-family, townhouse, duplex, condo, co-op, loft, lots and commercial, with beds, baths, lot size, HOA and year built.'], ['Can I track earnest money and closing checklists?', 'Yes. Each sale has a checklist you can edit. The starter checklist is sample wording to be reviewed by your own advisers.']],
  },
  UK: {
    slug: 'uk', flag: '🇬🇧',
    // CRM-first headline for this market; {city} is filled only for the listed cities (no local office or customer is implied)
    crm: { hook: 'Every applicant, viewing and offer in one CRM.', sub: 'Manage enquiries, applicants and vendors, property interests and offers from one workspace, so your team knows who to contact, what happens next and where every sale stands.', city_hook: 'Manage every property lead across {city}.', cities: ['London', 'Manchester', 'Birmingham', 'Leeds', 'Liverpool', 'Bristol', 'Glasgow', 'Edinburgh', 'Sheffield', 'Nottingham'], emphasis: ['Viewings in Google Calendar', 'Tenure, EPC and council tax on listings', 'Stamp Duty calculator for your website'] },
    works_with: ['Listing feeds for Rightmove and Zoopla', 'OnTheMarket', 'Twilio calling and texting', 'Google Calendar', 'Facebook, Instagram, LinkedIn and TikTok', 'Your own domain'],
    calls: 'Calls and texts run through your own Twilio account.',
    hero_title: 'Sales, lettings and construction in one system',
    hero_subtitle: 'Manage vendors, buyers and landlords, track every sale from offer to completion, and see Stamp Duty and mortgage costs on your website. Priced in pounds, measured in square feet and square metres.',
    chips: ['Sales and lettings', 'Stamp Duty calculator', 'Tenure, EPC and council tax band', 'Mortgage referral tracking', 'UK GDPR tools'],
    calc_title: 'Try the numbers for the United Kingdom', calc_sub: 'A repayment or interest-only mortgage and Stamp Duty Land Tax for England and Northern Ireland. Estimates only.',
    faqs: [['Does it handle freehold, leasehold and EPC details?', 'Yes. UK listings carry tenure, council tax band, EPC rating, ground rent and service charge.'], ['Is Scotland and Wales covered?', 'The Stamp Duty calculator uses England and Northern Ireland rates today. Scottish and Welsh taxes are planned as separate data.']],
  },
  AE: {
    slug: 'ae', flag: '🇦🇪',
    // CRM-first headline for this market; {city} is filled only for the listed cities (no local office or customer is implied)
    crm: { hook: 'Every enquiry, viewing and deal for your UAE brokerage.', sub: 'Manage enquiries, client relationships, ready and off-plan interests and deals from one workspace, so your team knows who to contact, what happens next and where every opportunity stands.', city_hook: 'Manage every property lead across {city}.', cities: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah'], emphasis: ['Ready and off-plan listings', 'Payment plans', 'Permit number on listings'] },
    works_with: ['Listing feeds for Bayut and dubizzle', 'Property Finder listing feed', 'Twilio calling and texting', 'Google Calendar', 'Facebook, Instagram, LinkedIn and TikTok', 'Your own domain'],
    calls: 'Calls and texts run through your own Twilio account.',
    hero_title: 'Property brokerage and construction for the UAE',
    hero_subtitle: 'Ready and off-plan listings, payment plans, mortgage tracking and Dubai Land Department fee estimates, in dirhams and square feet with an Arabic option.',
    chips: ['Ready and off-plan', 'DLD fee calculator', 'Payment plans', 'Arabic and English', 'Permit number on listings'],
    calc_title: 'Try the numbers for the UAE', calc_sub: 'A mortgage payment and Dubai Land Department purchase fees. Estimates only; other emirates differ.',
    faqs: [['Is there an Arabic interface?', 'Yes, the application can switch to Arabic with a right-to-left layout. Arabic text is being reviewed by a native speaker before it is switched on for customers.'], ['Can I record permit numbers on listings?', 'Yes. Listings have a field for the advertising permit number.']],
  },
  PK: {
    slug: 'pk', flag: '🇵🇰',
    // CRM-first headline for this market; {city} is filled only for the listed cities (no local office or customer is implied)
    crm: { hook: 'One CRM for every property lead in Pakistan.', sub: 'Manage enquiries, client relationships, plot and property interests and deals from one workspace, so your team knows who to contact, what happens next and where every opportunity stands.', city_hook: 'Manage every property lead across {city}.', cities: ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar'], emphasis: ['Plot files and instalment plans', 'Website and portal enquiries', 'Agents see only their own leads'] },
    works_with: ['Listing feeds for Zameen and Lamudi', 'Your robocall voice provider', 'Google Calendar', 'Facebook, Instagram, LinkedIn and TikTok', 'Your own domain'],
    calls: 'Calls run through your Pakistani voice provider (robocall service) with your own API key.',
    hero_title: null, hero_subtitle: null,
    chips: ['Plot files and installment plans', 'Marla and Kanal', 'Balloon payments', 'Customer portal', 'Two-factor sign-in'],
    calc_title: 'Try the numbers for Pakistan', calc_sub: 'Convert between Marla, Kanal, square feet and square yards.',
    faqs: [],
  },
  CA: {
    slug: 'ca', flag: '🇨🇦',
    // CRM-first headline for this market; {city} is filled only for the listed cities (no local office or customer is implied)
    crm: { hook: 'One CRM for your real estate team in Canada.', sub: 'Manage enquiries, buyers and sellers, property interests and offers from one workspace, so your team knows who to contact, what happens next and where every deal stands.', city_hook: 'One CRM for your real estate team in {city}.', cities: ['Toronto', 'Vancouver', 'Calgary', 'Montreal', 'Ottawa', 'Edmonton', 'Winnipeg'], emphasis: ['Showings in Google Calendar', 'Mortgage calculator for your website', 'English and French'] },
    works_with: ['MLS (RESO Web API)', 'REALTOR.ca listing feed', 'Twilio calling and texting', 'Google Calendar', 'Facebook, Instagram, LinkedIn and TikTok', 'Your own domain'],
    calls: 'Calls and texts run through your own Twilio account.',
    hero_title: 'Brokerage and construction management for Canada',
    hero_subtitle: 'Listings, clients, offers and commissions, with mortgage estimates that follow Canadian compounding. Priced in Canadian dollars, in English and French.',
    chips: ['Mortgage calculator', 'English and French', 'Sq ft and sq m', 'Mortgage referral tracking', 'Privacy tools'],
    calc_title: 'Try the numbers for Canada', calc_sub: 'A mortgage payment using semi-annual compounding and an estimated closing-cost allowance. Estimates only.',
    faqs: [],
  },
};
