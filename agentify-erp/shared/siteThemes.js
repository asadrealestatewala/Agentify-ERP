/**
 * The website theme library: complete starter websites a workspace can install from the editor's Themes panel.
 *
 * A theme is a design (colours, fonts, corner roundness, header and footer look) plus a set of pages built from the
 * normal website blocks (SECTION_TYPES in client/src/site/siteCore.jsx), so everything stays editable afterwards.
 * The layouts follow common real estate website patterns (search-first portal, rentals, single property showcase,
 * agency); they are original and copy no code, artwork or text from any commercial theme.
 *
 * Wording is a prompt for the company to rewrite. Nothing invents figures, customers, reviews or partners: numbers come
 * from the ERP (live numbers block), reviews only from approved visitor reviews, photos from the workspace's own listings.
 *
 * Shared by the editor (preview and install) and the server (install checks which pages a theme may write).
 */

const b = (type, props = {}) => ({ type, props });

const ABOUT_TEXT = 'Introduce the company in a few sentences: who you are, the areas you cover and how you work with buyers, sellers and tenants.';

export const SITE_THEMES = [
  {
    id: 'skyline',
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
          { icon: '🏡', title: 'Homes for sale', text: 'Browse every property we are selling, with photos, prices and payment options.', href: '/site/properties?purpose=Sell' },
          { icon: '🔑', title: 'Homes for rent', text: 'Find a place to rent and book a viewing with the agent.', href: '/site/properties?purpose=Rent' },
          { icon: '🏷️', title: 'Sell with us', text: 'Tell us about your property and get a free valuation.', href: '/site/p/sell' },
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
          { icon: '📸', title: 'We market your home', text: 'Photos, a clear listing and viewings handled for you.', href: '/site/p/contact' },
          { icon: '🧾', title: 'We find the right tenant', text: 'Describe how you check tenants.', href: '/site/p/contact' },
          { icon: '🛠️', title: 'We look after it', text: 'Describe your management service, if you offer one.', href: '/site/p/contact' },
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
        b('imagetext', { title: 'The home', text: 'Describe the rooms, the light, the finishes and how it feels to live here.', image_side: 'right', photo: 1 }),
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
          { icon: '✅', title: 'Verified listings', text: 'Describe how you check each property before it is listed.', href: '/site/properties' },
          { icon: '💬', title: 'Quick replies', text: 'Tell visitors how fast you answer calls and messages.', href: '/site/p/contact' },
          { icon: '📄', title: 'Clear paperwork', text: 'Explain how you help with documents and payments.', href: '/site/p/about' },
        ] }),
        b('listings', { title: 'Featured properties', source: 'featured', limit: 8, layout: 'carousel', view_all_href: '/site/properties' }),
        b('imagetext', { title: 'Meet your agent', text: 'Introduce the lead agent or founder: experience, areas covered and how to reach them.', image_side: 'left', button_label: 'Contact me', button_href: '/site/p/contact', photo: 1 }),
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
];

export const themeById = (id) => SITE_THEMES.find((t) => t.id === id) || null;

/** Keys a theme block may carry that are instructions to the builder, not block settings. */
export const THEME_BUILD_KEYS = ['photo', 'photos', 'anchor'];
