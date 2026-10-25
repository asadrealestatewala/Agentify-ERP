/**
 * The website theme library: complete starter websites a workspace can install from the editor's Themes panel.
 *
 * A theme is a design (colours, fonts, corner roundness, header and footer look) plus a set of pages built from the
 * normal website blocks (SECTION_TYPES in client/src/site/siteCore.jsx), so everything stays editable afterwards.
 * The layouts follow common real estate website patterns (search-first portal, rentals, single property showcase,
 * agency); they are original and copy no code, artwork or text from any commercial theme.
 *
 * `origin` tells the library where a theme comes from: 'original' (designed by Agentify) or 'adaptation' (an Agentify
 * composition that takes its general visual direction from an open-source project). Adaptations carry a `source` record
 * that is also written out in docs/website-themes/THEME_SOURCES.md. No code, photos, text, logos or fonts are copied from
 * a source; the pages are rebuilt from Agentify's own blocks.
 *
 * Wording is a prompt for the company to rewrite. Nothing invents figures, customers, reviews or partners: numbers come
 * from the ERP (live numbers block), reviews only from approved visitor reviews, photos from the workspace's own listings (or the sample photos
 * in client/public/site/theme-*.jpg until it has some). A theme may carry its own `samplePhotos` (Horizon Luxury does).
 *
 * Shared by the editor (preview and install) and the server (install checks which pages a theme may write).
 */

const b = (type, props = {}) => ({ type, props });

const ABOUT_TEXT = 'Introduce the company in a few sentences: who you are, the areas you cover and how you work with buyers, sellers and tenants.';

export const SITE_THEMES = [
  {
    id: 'skyline',
    origin: 'original',
    name: 'Skyline',
    kind: 'Property portal',
    tagline: 'Search first: a big photo with a search panel, service cards, featured and rental listings, agents and live numbers.',
    best: 'Agencies and brokers with many listings',
    design: {
      theme: { primary: '#0b5cad', accent: '#22a06b', dark: '#0b1f33', bg: '#ffffff', soft: '#f2f6fa', font_heading: 'Montserrat', font_body: 'Open Sans', radius: 6 },
      header: { style: 'transparent', topbar: true, sticky: false },
      footer: { style: 'dark' },
    },
    pages: [
      { slug: 'home', title: 'Home', blocks: [
        b('hero', { variant: 'search', headline: 'Find the home that fits your life', subheadline: 'Search homes, apartments and plots for sale or rent in your area.', show_search: true, height: 'tall', overlay: 45, photo: 0 }),
        b('services', { variant: 'raised', overlap: true, title: 'How we can help', link_label: 'Learn more', items: [
          { icon: 'residential', title: 'Homes for sale', text: 'Browse every property we are selling, with photos, prices and payment options.', href: '/site/properties?purpose=Sell' },
          { icon: 'key', title: 'Homes for rent', text: 'Find a place to rent and book a viewing with the agent.', href: '/site/properties?purpose=Rent' },
          { icon: 'sell', title: 'Sell with us', text: 'Tell us about your property and get a free valuation.', href: '/site/p/sell' },
        ] }),
        b('listings', { title: 'Featured properties', subtitle: 'Hand-picked by our agents', source: 'featured', limit: 6, layout: 'grid', columns: 3, view_all_href: '/site/properties' }),
        b('livestats'),
        b('listings', { title: 'Latest for rent', source: 'latest', purpose: 'Rent', limit: 8, layout: 'carousel', card: 'overlay', view_all_href: '/site/properties?purpose=Rent' }),
        b('agents', { title: 'Our agents', subtitle: 'Call or message the agent for any listing', limit: 4 }),
        b('reviews', { title: 'What our customers say' }),
        b('cta', { headline: 'Thinking of selling?', text: 'Book a free valuation with a local agent.', button_label: 'Get a valuation', button_href: '/site/p/sell', tone: 'primary' }),
      ] },
      { slug: 'about', title: 'About us', show_in_menu: true, blocks: [
        b('hero', { headline: 'About us', subheadline: 'Who we are and how we work.', show_search: false, height: 'medium', overlay: 55, photo: 1 }),
        b('imagetext', { title: 'Our story', text: ABOUT_TEXT, image_side: 'right', photo: 2 }),
        b('services', { variant: 'steps', title: 'How we work', items: [
          { icon: '', title: 'Tell us what you need', text: 'Budget, area and the kind of property you want.', href: '' },
          { icon: '', title: 'View the right homes', text: 'We shortlist and arrange viewings that suit you.', href: '' },
          { icon: '', title: 'Move in with confidence', text: 'We guide you through the offer, paperwork and handover.', href: '' },
        ] }),
        b('agents', { title: 'Meet the team', limit: 8 }),
        b('cta', { headline: 'Ready to start?', text: 'Talk to an agent today.', button_label: 'Contact us', button_href: '/site/p/contact', tone: 'dark' }),
      ] },
      { slug: 'sell', title: 'Sell with us', show_in_menu: true, blocks: [
        b('hero', { variant: 'form', headline: 'Sell your property with a local expert', subheadline: 'Describe what you offer sellers: valuation, marketing, viewings and negotiation.', form_title: 'Request a free valuation', height: 'medium', overlay: 60, photo: 3 }),
        b('services', { variant: 'steps', title: 'How selling works', items: [
          { icon: '', title: 'Valuation', text: 'We visit, look at recent sales nearby and agree a price with you.', href: '' },
          { icon: '', title: 'Marketing', text: 'Photos, a listing on our website and the portals you choose.', href: '' },
          { icon: '', title: 'Viewings and offers', text: 'We show the property and bring every offer to you.', href: '' },
          { icon: '', title: 'Completion', text: 'We follow the sale through to the handover.', href: '' },
        ] }),
        b('faq', { title: 'Questions sellers ask', items: [{ q: 'How much does it cost to sell?', a: 'Explain your fees here.' }, { q: 'How long does a sale take?', a: 'Give a typical timeline for your area.' }] }),
      ] },
      { slug: 'contact', title: 'Contact', blocks: [
        b('hero', { headline: 'Contact us', subheadline: 'Call, message or visit our office.', show_search: false, height: 'medium', overlay: 55, photo: 4 }),
        b('contact', { title: 'Get in touch', text: 'We usually reply within one working day.', show_form: true, show_details: true }),
        b('booking', {}),
      ] },
    ],
  },
  {
    id: 'haven',
    origin: 'original',
    name: 'Haven',
    kind: 'Rentals and bookings',
    tagline: 'Warm and friendly: a rental search, photo cards, a simple how-it-works, viewing bookings and FAQs.',
    best: 'Letting agents, short-stay and serviced apartments',
    design: {
      theme: { primary: '#e0475a', accent: '#f6a823', dark: '#1d2a3a', bg: '#ffffff', soft: '#fdf4f2', font_heading: 'Nunito', font_body: 'Nunito', radius: 16 },
      header: { style: 'light', topbar: false, sticky: true },
      footer: { style: 'light' },
    },
    pages: [
      { slug: 'home', title: 'Home', blocks: [
        b('hero', { variant: 'search', headline: 'Find a place you will love to live', subheadline: 'Homes and apartments to rent, ready for you to view.', show_search: true, search_tab: 'Rent', height: 'tall', overlay: 35, photo: 0 }),
        b('listings', { title: 'Popular places to rent', source: 'latest', purpose: 'Rent', limit: 8, layout: 'grid', columns: 4, card: 'overlay', view_all_href: '/site/properties?purpose=Rent' }),
        b('services', { variant: 'steps', title: 'How it works', subtitle: 'From search to keys in three steps', items: [
          { icon: '', title: 'Search', text: 'Filter by area, budget and size to find homes that fit.', href: '/site/properties?purpose=Rent' },
          { icon: '', title: 'Book a viewing', text: 'Pick a day and time and the agent confirms it with you.', href: '' },
          { icon: '', title: 'Move in', text: 'Sign the agreement and collect your keys.', href: '' },
        ] }),
        b('listings', { title: 'Featured homes', source: 'featured', limit: 6, layout: 'carousel', view_all_href: '/site/properties' }),
        b('booking', { title: 'Book a viewing', subtitle: 'Choose a day and time. We will confirm by phone.' }),
        b('reviews', { title: 'What our tenants say' }),
        b('faq', { title: 'Good to know', items: [{ q: 'What do I need to rent a home?', a: 'List the documents and deposit you ask for.' }, { q: 'Can I view a home before I decide?', a: 'Yes. Book a viewing above or call us.' }] }),
      ] },
      { slug: 'how-it-works', title: 'How it works', show_in_menu: true, blocks: [
        b('banner', { text: 'How renting with us works', tone: 'primary' }),
        b('imagetext', { title: 'Renting made simple', text: 'Explain your rental process, what is included and how you look after tenants and landlords.', image_side: 'left', photo: 1 }),
        b('services', { variant: 'cards', title: 'For landlords', items: [
          { icon: 'photos', title: 'We market your home', text: 'Photos, a clear listing and viewings handled for you.', href: '/site/p/contact' },
          { icon: 'receipt', title: 'We find the right tenant', text: 'Describe how you check tenants.', href: '/site/p/contact' },
          { icon: 'tools', title: 'We look after it', text: 'Describe your management service, if you offer one.', href: '/site/p/contact' },
        ] }),
        b('faq', { title: 'Questions', items: [{ q: 'Add a question', a: 'Add the answer.' }] }),
      ] },
      { slug: 'contact', title: 'Contact', blocks: [
        b('banner', { text: 'We are here to help', tone: 'primary' }),
        b('contact', { title: 'Contact us', text: 'Ask about a home, a viewing or letting your property.', show_form: true, show_details: true }),
      ] },
    ],
  },
  {
    id: 'maison',
    origin: 'original',
    name: 'Maison',
    kind: 'Single property',
    tagline: 'Elegant and calm: one property presented with large photos, key facts, the neighbourhood and a private viewing form.',
    best: 'A single home, a new building or a premium launch',
    design: {
      theme: { primary: '#1f1f1f', accent: '#c2a36b', dark: '#141414', bg: '#fbfaf7', soft: '#f1ede4', font_heading: 'Playfair Display', font_body: 'Manrope', radius: 2 },
      header: { style: 'transparent', topbar: false, sticky: false },
      footer: { style: 'dark' },
    },
    pages: [
      { slug: 'home', title: 'Home', blocks: [
        b('hero', { headline: 'The Residence', subheadline: 'Describe the property in one sentence: where it is and what makes it special.', align: 'center', show_search: false, height: 'tall', overlay: 35, cta_label: 'Book a private viewing', cta_href: '#viewing', photo: 0 }),
        b('stats', { items: [{ value: '—', label: 'Bedrooms' }, { value: '—', label: 'Bathrooms' }, { value: '—', label: 'Living area' }, { value: '—', label: 'Plot size' }] }),
        b('imagetext', { title: 'The home', text: 'Describe the rooms, the light, the finishes and how it feels to live here.', image_side: 'right', photo: 1, demo: 'house' }),
        b('imagetext', { title: 'The neighbourhood', text: 'Schools, parks, shops and travel times that matter to buyers.', image_side: 'left', photo: 2 }),
        b('gallery', { title: 'Gallery', photos: 6 }),
        b('booking', { title: 'Book a private viewing', subtitle: 'Choose a day and time. We will confirm by phone.', anchor: 'viewing' }),
        b('contact', { title: 'Ask about the property', text: '', show_form: true, show_details: true }),
      ] },
      { slug: 'gallery', title: 'Gallery', show_in_menu: true, blocks: [
        b('banner', { text: 'Gallery', tone: 'dark' }),
        b('gallery', { title: '', photos: 12 }),
        b('cta', { headline: 'See it in person', text: 'Private viewings by appointment.', button_label: 'Book a viewing', button_href: '/site#viewing', tone: 'dark' }),
      ] },
      { slug: 'contact', title: 'Contact', blocks: [
        b('banner', { text: 'Contact', tone: 'dark' }),
        b('contact', { title: 'Speak to the sales team', text: '', show_form: true, show_details: true }),
      ] },
    ],
  },
  {
    id: 'homestead',
    origin: 'original',
    name: 'Homestead',
    kind: 'Modern agency',
    tagline: 'Clean and bright: text beside a photo with search, recent listings, why-choose-us cards, your agents, blog and reviews.',
    best: 'Agencies, brokers and developers that want a modern look',
    design: {
      theme: { primary: '#0e9f6e', accent: '#ffb020', dark: '#0f2a22', bg: '#ffffff', soft: '#f1f8f5', font_heading: 'Poppins', font_body: 'Inter', radius: 12 },
      header: { style: 'light', topbar: true, sticky: true },
      footer: { style: 'dark' },
    },
    pages: [
      { slug: 'home', title: 'Home', blocks: [
        b('hero', { variant: 'split', headline: 'Real estate, made simple', subheadline: 'Buy, sell or rent with a team that keeps you informed at every step.', show_search: true, height: 'tall', photo: 0 }),
        b('listings', { title: 'Recent listings', subtitle: 'New on the market', source: 'latest', limit: 8, layout: 'grid', columns: 4, view_all_href: '/site/properties' }),
        b('services', { variant: 'cards', title: 'Why choose us', items: [
          { icon: 'verified', title: 'Verified listings', text: 'Describe how you check each property before it is listed.', href: '/site/properties' },
          { icon: 'chat', title: 'Quick replies', text: 'Tell visitors how fast you answer calls and messages.', href: '/site/p/contact' },
          { icon: 'paperwork', title: 'Clear paperwork', text: 'Explain how you help with documents and payments.', href: '/site/p/about' },
        ] }),
        b('listings', { title: 'Featured properties', source: 'featured', limit: 8, layout: 'carousel', view_all_href: '/site/properties' }),
        b('imagetext', { title: 'Meet your agent', text: 'Introduce the lead agent or founder: experience, areas covered and how to reach them.', image_side: 'left', button_label: 'Contact me', button_href: '/site/p/contact', photo: 1, demo: 'agent-2' }),
        b('agents', { title: 'Our team', limit: 4 }),
        b('blog', { title: 'News and guides', limit: 3 }),
        b('reviews', { title: 'Client reviews' }),
        b('cta', { headline: 'Looking for your next home?', text: 'Tell us what you need and we will send matching properties.', button_label: 'Start your search', button_href: '/site/properties', tone: 'primary' }),
      ] },
      { slug: 'about', title: 'About us', show_in_menu: true, blocks: [
        b('hero', { variant: 'split', headline: 'About us', subheadline: 'A short line about who you are.', show_search: false, height: 'medium', photo: 2 }),
        b('text', { title: 'Our story', html: `<p>${ABOUT_TEXT}</p>`, align: 'left' }),
        b('livestats'),
        b('agents', { title: 'Our team', limit: 8 }),
      ] },
      { slug: 'contact', title: 'Contact', blocks: [
        b('banner', { text: 'Contact us', tone: 'primary' }),
        b('contact', { title: 'We would love to hear from you', text: 'Call, message or send the form.', show_form: true, show_details: true }),
        b('booking', {}),
      ] },
    ],
  },
  {
    id: 'horizon',
    origin: 'adaptation',
    source: {
      name: 'Horizon Estate',
      url: 'https://github.com/dmsda/horizon-estate',
      license: 'MIT',
      copyright: 'Copyright (c) 2026 Horizon Estate Project Contributors',
      reviewed: '2026-10-25',
      used: 'General visual direction only: architectural minimalism, black and champagne palette, editorial type, generous white space, a page list of collection, developments, advisors, about and contact.',
      copied: 'No source code, text, logos or fonts. Ten demo photos of homes and villas (not people) were copied, resized and kept as sample pictures (see assets). Fonts are Agentify\'s own list (Playfair Display and Manrope, both SIL Open Font License 1.1).',
      assets: 'Ten photos from public/images/hero and public/images/properties, licensed under the Unsplash License (free for commercial use, no attribution required) as stated in the source\'s ASSETS.md. The source calls them demonstration photos to be replaced before a commercial launch; here they are sample pictures that each company replaces with its own. Per-photo credits are not given by the source. Agent portraits, journal, service and office photos, floor plans and screenshots were not used.',
    },
    name: 'Horizon Luxury',
    kind: 'Luxury and developers',
    tagline: 'Architectural and calm: a full-width hero, a curated collection, developments with progress, advisors and private viewings.',
    best: 'Premium agencies, luxury brokers and developers with signature projects',
    samplePhotos: ['/site/horizon-dusk-villa.jpg', '/site/horizon-beach-house.jpg', '/site/horizon-white-villa.jpg', '/site/horizon-cliff-villa.jpg', '/site/horizon-pool-house.jpg', '/site/horizon-island-retreat.jpg', '/site/horizon-mountain-lodge.jpg', '/site/horizon-ocean-breeze.jpg', '/site/horizon-hillside-home.jpg', '/site/horizon-jungle-home.jpg'],
    design: {
      theme: { primary: '#0a0a0a', accent: '#c5a880', dark: '#0a0a0a', bg: '#ffffff', soft: '#f6f6f4', font_heading: 'Playfair Display', font_body: 'Manrope', radius: 0 },
      header: { style: 'light', topbar: false, sticky: true },
      footer: { style: 'dark' },
    },
    pages: [
      { slug: 'home', title: 'Home', blocks: [
        b('hero', { headline: 'Architecture you can live in', subheadline: 'A curated collection of exceptional homes and landmark developments.', align: 'center', show_search: false, height: 'tall', overlay: 45, cta_label: 'View the collection', cta_href: '/site/p/collection', photo: 0 }),
        b('text', { title: 'A considered approach to property', html: `<p>${ABOUT_TEXT}</p>`, align: 'center' }),
        b('listings', { title: 'The collection', subtitle: 'Selected residences, presented in full', source: 'featured', limit: 6, layout: 'grid', columns: 3, card: 'overlay', view_all_href: '/site/p/collection' }),
        b('imagetext', { title: 'Designed to last', text: 'Describe your philosophy: the quality of the build, the locations you choose and the care you take with every client.', image_side: 'right', button_label: 'Our story', button_href: '/site/p/about', photo: 1 }),
        b('projects', { title: 'Developments', subtitle: 'Landmark projects, from first sketch to handover', limit: 3 }),
        b('livestats'),
        b('gallery', { title: 'Inside the portfolio', photos: 6 }),
        b('agents', { title: 'Your advisors', subtitle: 'Private, personal and discreet', limit: 4 }),
        b('reviews', { title: 'In their words' }),
        b('cta', { headline: 'Arrange a private viewing', text: 'Tell us what you are looking for and an advisor will be in touch.', button_label: 'Request a viewing', button_href: '/site/p/contact', tone: 'dark', photo: 2 }),
      ] },
      { slug: 'collection', title: 'The collection', show_in_menu: true, blocks: [
        b('hero', { variant: 'search', headline: 'The collection', subheadline: 'Search every residence we represent.', show_search: true, height: 'medium', overlay: 50, photo: 2 }),
        b('listings', { title: 'Residences for sale', source: 'latest', purpose: 'Sell', limit: 12, layout: 'grid', columns: 3, view_all_href: '/site/properties?purpose=Sell' }),
        b('listings', { title: 'Residences to rent', source: 'latest', purpose: 'Rent', limit: 6, layout: 'grid', columns: 3, view_all_href: '/site/properties?purpose=Rent' }),
        b('cta', { headline: 'Cannot see what you need?', text: 'Many of our best homes are shared privately. Tell us your brief.', button_label: 'Speak to an advisor', button_href: '/site/p/contact', tone: 'dark' }),
      ] },
      { slug: 'developments', title: 'Developments', show_in_menu: true, blocks: [
        b('hero', { headline: 'Developments', subheadline: 'Landmark projects built to a higher standard.', align: 'center', show_search: false, height: 'medium', overlay: 50, photo: 1 }),
        b('projects', { title: 'Current developments', limit: 6 }),
        b('projectinfo', { title: 'Our track record', intro: 'Add the figures you can stand behind and the projects you have delivered.' }),
        b('imagetext', { title: 'Craft in every detail', text: 'Explain how you choose architects, materials and builders, and how you keep buyers informed during construction.', image_side: 'left', photo: 0 }),
        b('cta', { headline: 'Register your interest', text: 'Be first to hear about new launches and private previews.', button_label: 'Get in touch', button_href: '/site/p/contact', tone: 'primary' }),
      ] },
      { slug: 'about', title: 'About us', show_in_menu: true, blocks: [
        b('hero', { headline: 'About us', subheadline: 'A short line about who you are.', align: 'center', show_search: false, height: 'medium', overlay: 55, photo: 2 }),
        b('imagetext', { title: 'Our story', text: ABOUT_TEXT, image_side: 'right', photo: 1 }),
        b('services', { variant: 'cards', title: 'What we stand for', items: [
          { icon: 'diamond', title: 'Discretion', text: 'Explain how you protect client privacy.', href: '' },
          { icon: 'diamond', title: 'Expertise', text: 'Describe the markets and property types you know best.', href: '' },
          { icon: 'diamond', title: 'Care', text: 'Describe how you look after clients before and after the sale.', href: '' },
        ] }),
        b('livestats'),
        b('leadership', { title: 'Leadership', subtitle: 'The people behind the company' }),
      ] },
      { slug: 'advisors', title: 'Advisors', show_in_menu: true, blocks: [
        b('hero', { headline: 'Our advisors', subheadline: 'Speak to the person who will look after you.', align: 'center', show_search: false, height: 'medium', overlay: 55, photo: 0 }),
        b('agents', { title: 'Meet the team', limit: 12 }),
        b('faq', { title: 'Working with us', items: [
          { q: 'How do private viewings work?', a: 'Explain how a client books, who attends and how long a viewing takes.' },
          { q: 'Do you sell off-market homes?', a: 'Say whether you share homes privately and how clients can ask about them.' },
        ] }),
      ] },
      { slug: 'contact', title: 'Contact', blocks: [
        b('hero', { headline: 'Contact', subheadline: 'Call, message or request a private viewing.', align: 'center', show_search: false, height: 'medium', overlay: 55, photo: 1 }),
        b('contact', { title: 'Speak to an advisor', text: 'Tell us about the home you are looking for or the property you would like to sell.', show_form: true, show_details: true }),
        b('booking', { title: 'Request a private viewing', subtitle: 'Choose a day and time. An advisor will confirm by phone.' }),
      ] },
    ],
  },
  {
    id: 'urban',
    origin: 'adaptation',
    source: {
      name: 'Tumon Art Real Estate',
      url: 'https://github.com/tumon-art/real_estate',
      license: 'MIT',
      copyright: 'Copyright (c) 2023 Tumon',
      reviewed: '2026-10-25',
      used: 'General structure only: a home page with a search-led hero, Buy and Rent entry points, for-sale and for-rent rows, agent cards, a neighbourhoods section and popular-search style links.',
      copied: 'Nothing. No source code, photos, text, logos, brand names or demo content were copied. The source\'s demo carries the name "Real Estate, Inc." and a network label, neither is used.',
      assets: 'The source does not state licences for its images, so none are used. Agentify\'s own sample photos fill the preview.',
    },
    name: 'Urban Living',
    kind: 'City brokerage and rentals',
    tagline: 'Buy and Rent first: a search-led hero, for-sale and for-rent rows, neighbourhoods, advisors, viewings and FAQs.',
    best: 'City brokerages, rental agencies and agents who serve buyers and tenants',
    design: {
      theme: { primary: '#4338ca', accent: '#f59e0b', dark: '#111827', bg: '#ffffff', soft: '#f4f5fb', font_heading: 'DM Sans', font_body: 'Inter', radius: 12 },
      header: { style: 'light', topbar: false, sticky: true },
      footer: { style: 'dark' },
    },
    pages: [
      { slug: 'home', title: 'Home', blocks: [
        b('hero', { variant: 'search', headline: 'Find your next place in the city', subheadline: 'Search homes to buy and rent, then book a viewing in a few taps.', show_search: true, height: 'tall', overlay: 40, photo: 0 }),
        b('services', { variant: 'raised', title: 'Where to start', items: [
          { icon: 'city', title: 'Buy', text: 'Browse homes for sale with photos, prices and floor areas.', href: '/site/properties?purpose=Sell' },
          { icon: 'key', title: 'Rent', text: 'Find an apartment or house to rent and book a viewing.', href: '/site/properties?purpose=Rent' },
          { icon: 'location', title: 'Explore areas', text: 'Learn what each neighbourhood is like before you visit.', href: '/site/p/neighbourhoods' },
        ] }),
        b('listings', { title: 'Homes for sale', subtitle: 'The newest properties on the market', source: 'latest', purpose: 'Sell', limit: 8, layout: 'grid', columns: 4, view_all_href: '/site/properties?purpose=Sell' }),
        b('listings', { title: 'Homes to rent', subtitle: 'Ready to view this week', source: 'latest', purpose: 'Rent', limit: 8, layout: 'carousel', view_all_href: '/site/properties?purpose=Rent' }),
        b('columns', { title: 'Check out a neighbourhood', subtitle: 'Write a line about the areas you cover', cols: 3, items: [
          { title: 'Neighbourhood one', text: 'Describe the area: transport, schools, parks and the feel of the streets.', button_label: 'See homes', button_href: '/site/properties' },
          { title: 'Neighbourhood two', text: 'Describe the area: what it is known for and who loves living there.', button_label: 'See homes', button_href: '/site/properties' },
          { title: 'Neighbourhood three', text: 'Describe the area: cafés, commute times and what is nearby.', button_label: 'See homes', button_href: '/site/properties' },
        ] }),
        b('agents', { title: 'Agents in your city', subtitle: 'Ask a question or book a viewing', limit: 4 }),
        b('faq', { title: 'Questions we hear often', items: [
          { q: 'How do I book a viewing?', a: 'Open a listing and send a viewing request, or call the agent shown on the card.' },
          { q: 'What do I need to rent a home?', a: 'List the documents and deposit you ask for from tenants.' },
          { q: 'Can you help me sell?', a: 'Explain your valuation and marketing process.' },
        ] }),
        b('reviews', { title: 'What our clients say' }),
        b('cta', { headline: 'Ready to move?', text: 'Tell us what you are looking for and we will send matching homes.', button_label: 'Start your search', button_href: '/site/properties', tone: 'primary' }),
      ] },
      { slug: 'buy', title: 'Buy', show_in_menu: true, blocks: [
        b('hero', { variant: 'search', headline: 'Homes for sale', subheadline: 'Filter by area, type and budget.', show_search: true, search_tab: 'Buy', height: 'medium', overlay: 45, photo: 1 }),
        b('listings', { title: 'Latest homes for sale', source: 'latest', purpose: 'Sell', limit: 12, layout: 'grid', columns: 3, view_all_href: '/site/properties?purpose=Sell' }),
        b('calculators', { title: 'Plan your purchase', subtitle: 'Work out payments before you view.' }),
        b('cta', { headline: 'Need help buying?', text: 'An agent can walk you through offers, paperwork and moving day.', button_label: 'Talk to an agent', button_href: '/site/p/contact', tone: 'dark' }),
      ] },
      { slug: 'rent', title: 'Rent', show_in_menu: true, blocks: [
        b('hero', { variant: 'search', headline: 'Homes to rent', subheadline: 'Find a place and book a viewing.', show_search: true, search_tab: 'Rent', height: 'medium', overlay: 45, photo: 2 }),
        b('listings', { title: 'Latest homes to rent', source: 'latest', purpose: 'Rent', limit: 12, layout: 'grid', columns: 3, view_all_href: '/site/properties?purpose=Rent' }),
        b('services', { variant: 'steps', title: 'Renting made simple', items: [
          { icon: '', title: 'Search and shortlist', text: 'Save the homes you like.', href: '' },
          { icon: '', title: 'View in person', text: 'Book a slot that suits you.', href: '' },
          { icon: '', title: 'Apply and move in', text: 'Explain your application and deposit steps.', href: '' },
        ] }),
        b('faq', { title: 'Renting FAQs', items: [
          { q: 'What deposit do you ask for?', a: 'State your deposit and what it covers.' },
          { q: 'Are pets allowed?', a: 'Say how pets are handled for each landlord.' },
        ] }),
      ] },
      { slug: 'neighbourhoods', title: 'Neighbourhoods', show_in_menu: true, blocks: [
        b('hero', { headline: 'Neighbourhoods', subheadline: 'Find the area that fits how you live.', show_search: false, height: 'medium', overlay: 50, photo: 0 }),
        b('columns', { title: 'Areas we cover', cols: 3, items: [
          { title: 'Neighbourhood one', text: 'Write about transport, schools, shops and parks. Add a photo of the area.', button_label: 'See homes', button_href: '/site/properties' },
          { title: 'Neighbourhood two', text: 'Write about the feel of the area, typical homes and prices.', button_label: 'See homes', button_href: '/site/properties' },
          { title: 'Neighbourhood three', text: 'Write about commute times, cafés and community life.', button_label: 'See homes', button_href: '/site/properties' },
        ] }),
        b('listings', { title: 'Homes across our areas', source: 'latest', limit: 8, layout: 'grid', columns: 4, view_all_href: '/site/properties' }),
      ] },
      { slug: 'agents', title: 'Agents', show_in_menu: true, blocks: [
        b('hero', { headline: 'Our agents', subheadline: 'Local people who know the market.', show_search: false, height: 'medium', overlay: 55, photo: 1 }),
        b('agents', { title: 'Meet the team', limit: 12 }),
        b('booking', { title: 'Book a viewing', subtitle: 'Pick a day and time. The agent will confirm by phone.' }),
      ] },
      { slug: 'faq', title: 'FAQs', show_in_menu: true, blocks: [
        b('banner', { text: 'Help and answers', tone: 'primary' }),
        b('faq', { title: 'Buying', items: [
          { q: 'How do I make an offer?', a: 'Explain the steps from viewing to offer to agreement.' },
          { q: 'Do you charge buyers a fee?', a: 'State your fees plainly, or say that buyers pay nothing.' },
        ] }),
        b('faq', { title: 'Renting', items: [
          { q: 'How long is a tenancy?', a: 'State the usual length and how renewals work.' },
          { q: 'Who pays for repairs?', a: 'Explain how maintenance requests are handled.' },
        ] }),
      ] },
      { slug: 'about', title: 'About us', show_in_menu: true, blocks: [
        b('hero', { variant: 'split', headline: 'About us', subheadline: 'A short line about who you are.', show_search: false, height: 'medium', photo: 2 }),
        b('text', { title: 'Our story', html: `<p>${ABOUT_TEXT}</p>`, align: 'left' }),
        b('livestats'),
        b('agents', { title: 'The team', limit: 8 }),
      ] },
      { slug: 'contact', title: 'Contact', blocks: [
        b('banner', { text: 'Contact us', tone: 'primary' }),
        b('contact', { title: 'We would love to hear from you', text: 'Call, message or send the form.', show_form: true, show_details: true }),
        b('booking', {}),
      ] },
    ],
  },
];

export const themeById = (id) => SITE_THEMES.find((t) => t.id === id) || null;

/** Keys a theme block may carry that are instructions to the builder, not block settings. */
export const THEME_BUILD_KEYS = ['photo', 'photos', 'anchor', 'demo'];
