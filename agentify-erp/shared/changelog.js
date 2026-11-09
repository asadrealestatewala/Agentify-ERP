// The single source of truth for the product version and the "What's new" page.
// Version key: vMAJOR.MINOR. Every shipped update adds an entry at the TOP and the version goes up by one minor
// step (v1.0 -> v1.1 -> v1.2). A big release moves to the next major (v2.0). The app version is the first entry.
// Items are for the workspace (tenant) by default. Mark platform-only items (Super Admin console, integrations keys,
// billing/inbox operations) with `audience: 'platform'`; they never show in a workspace. See "What's new audiences" in CLAUDE.md.
// Write for customers: plain words, what changed and where to find it. See "Releases and versions" in CLAUDE.md.
export const CHANGELOG = [
  {
    version: 'v1.90', date: '2026-11-09', title: 'USA pricing plans',
    items: [
      { text: 'Customers in the United States now see the plan ladder in US dollars: Agent Plus $29, Agency Starter $79, Agency Growth $149, Agency Pro $249, Developer $449 and Enterprise from $999 a month, with 6-month and yearly discounts and US-dollar add-ons. The wording for US customers drops Pakistan-only items. Plans with no price in a visitor\'s currency are no longer shown to them.', where: 'Public website > Pricing', audience: 'platform' },
      { text: 'Card payments for the ladder in US dollars need their own Stripe prices. Create a USD price for each plan (monthly and yearly) in Stripe and paste the ids into the new "..._usd" slots on the Stripe page. Until then US customers can pay by bank transfer or online gateway.', where: 'Console > Billing > Stripe', audience: 'platform' },
    ],
  },
  {
    version: 'v1.89', date: '2026-11-09', title: 'Plans now start at Agent Plus',
    items: [
      { text: 'The plan ladder now starts at Agent Plus (1,500 rupees a month) with installments, receipts, WhatsApp reminders and the Android and desktop app that keeps working offline for notes, tasks and leads. The Solo Agent plan is retired; its workspaces moved to Agent Plus at the price they pay.', where: 'Console > Plans', audience: 'platform' },
      { text: 'Agency Starter is now 5,000 rupees a month and adds HRM (employees, attendance, leave, salary) and the free website. Meta (Facebook and Instagram) and the social media scheduler come with Agency Pro. The pricing page lists exactly what each plan includes.', where: 'Console > Plans', audience: 'platform' },
    ],
  },
  {
    version: 'v1.88', date: '2026-11-09', title: 'Console: photos on the new Agentify ERP articles',
    items: [
      { text: 'New PageSpeed card: pick the blog index or one of your newest articles and see its Google speed, SEO, accessibility and best-practice scores for phones, plus a short list of things to fix.', where: 'Console > Marketing > Blog agent > PageSpeed', audience: 'platform' },
      { text: 'The Blog agent can now connect to Google Search Console (read-only). The page shows the last 28 days of clicks, times shown, average position, your top searches and top pages, and the agent uses the real searches as inspiration for new topics.', where: 'Console > Marketing > Blog agent > Search Console', audience: 'platform' },
      { text: 'The six new Agentify ERP articles now show Unsplash photos with the photographer credit instead of the plain cover graphic.', where: 'Public website > Blog', audience: 'platform' },
      { text: 'If the Blog agent cannot find a photo for a new draft it tries a simpler search, and if it still finds none the draft shows a note (check the Unsplash key and its hourly limit) and is not auto-published. Every hour the agent also adds photos to articles that still have none, so they fix themselves once the Unsplash limit resets.', where: 'Console > Marketing > Blog agent', audience: 'platform' },
    ],
  },
  {
    version: 'v1.87', date: '2026-11-09', title: 'Console: Blog agent alerts, Groq fix and brand-building articles',
    items: [
      { text: 'Groq retired its old default chat model, so Groq answers failed with "model does not exist". The default is now openai/gpt-oss-120b. A model you typed yourself in the Groq settings is kept.', where: 'Console > AI > Groq and Ask engines', audience: 'platform' },
      { text: 'The Blog agent no longer gives up when Groq returns broken JSON for an article: it asks again in plain mode and retries the article once before reporting an error.', where: 'Console > Marketing > Blog agent', audience: 'platform' },
      { text: 'The alerts bell now tells you when the Blog agent has drafts waiting for review and after every run (how many articles it made and how many went live), so you no longer have to open the page to find out.', where: 'Console > Alerts', audience: 'platform' },
      { text: 'The public blog now says Agentify ERP clearly: every article has an Agentify ERP byline, a short "about Agentify ERP" closing with a link, and a question about it in the FAQ. Six new articles explain what Agentify ERP is and compare it honestly with spreadsheets and generic CRMs for Pakistan property dealers.', where: 'Public website > Blog', audience: 'platform' },
      { text: 'The Blog agent now writes about one in three of its daily articles as an Agentify ERP or comparison piece, names the product in the title and text, and rejects drafts with made-up claims such as prices, rankings, customer counts or testimonials.', where: 'Console > Marketing > Blog agent', audience: 'platform' },
    ],
  },
  {
    version: 'v1.86', date: '2026-11-09', title: 'Ask can look up your records',
    items: [
      { text: 'Ask now answers questions about specific records, for example a customer, a plot, a sale, an instalment, a receipt, a vendor or a staff member, by looking them up in your workspace. It only sees what the person asking is allowed to open, and sales agents only see their own.', where: 'Ask (Data assistant)' },
      { text: 'Admins can switch record look-up off.', where: 'Settings > System settings > Ask assistant' },
    ],
  },
  {
    version: 'v1.85', date: '2026-11-09', title: 'Ask understands spelling mistakes and knows the whole menu',
    items: [
      { text: 'Ask now repairs spelling slips (for example "whastapp") before searching, in English, Urdu and Roman Urdu.', where: 'Ask (Data assistant)' },
      { text: 'When no guide matches a question, Ask now looks at the whole menu and tells you which screen fits, instead of saying it could not match.', where: 'Ask (Data assistant)' },
    ],
  },
  {
    version: 'v1.84', date: '2026-11-09', title: 'Ask sounds more human and knows your business',
    items: [
      { text: 'Ask now answers like a friendly colleague: natural wording, your first name now and then, and everyday Roman Urdu. Admins can switch it to a formal, brief style.', where: 'Settings > System settings > Ask assistant' },
      { text: 'Report answers such as lead counts now start with a short friendly sentence. The exact answer and tables stay unchanged right below it, and the sentence is dropped if it would show any figure that is not in the exact answer. Admins can switch this off.', where: 'Settings > System settings > Ask assistant' },
      { text: 'Teach Ask about your business: add office hours, payment and refund rules or FAQs, and Ask uses them when staff ask about the company. Your company phone, email and address are included automatically.', where: 'Settings > System settings > Ask assistant' },
    ],
  },
  {
    version: 'v1.83', date: '2026-11-08', title: 'Console: choose Gemini or Groq for the blog agent',
    items: [
      { text: 'The Blog agent can now write with Groq as well as Gemini. Pick the writing engine in its settings; if the chosen engine fails, the other one is used when it is connected.', where: 'Console > Marketing > Blog agent', audience: 'platform' },
    ],
  },
  {
    version: 'v1.82', date: '2026-11-08', title: 'Console: Blog agent writes daily blog drafts for you to approve',
    items: [
      { text: 'A new Blog agent page researches topics on the web, writes original articles and saves them as drafts, up to a daily limit you set (5 to start, 10 at most). Each draft shows its quality checks and sources; you edit it, then Approve and publish, or Reject. Nothing reaches the blog without your approval unless you switch on auto-publish.', where: 'Console > Marketing > Blog agent', audience: 'platform' },
      { text: 'Published agent articles join the public blog and the sitemap automatically.', where: 'Console > Marketing > Blog agent', audience: 'platform' },
    ],
  },
  {
    version: 'v1.81', date: '2026-11-08', title: 'Ask: "how do I ..." questions get a step-by-step answer',
    items: [
      { text: 'Questions like "how do I add a lead?" or "me kese appointment add kar sakta hu" now go to the help guides instead of showing lead statistics. New step guides cover adding a lead, scheduling an appointment, adding a property, creating an installment plan and creating a voucher.', where: 'Ask (Data assistant)' },
      { text: 'Data answers now say they are a live report from your ERP, and when no AI engine is switched on Ask still answers from the help guides.', where: 'Ask (Data assistant)' },
    ],
  },
  {
    version: 'v1.80', date: '2026-11-08', title: 'Console: test and switch each Ask engine',
    items: [
      { text: 'Each engine in the Ask engine order now has a Test this engine button. It sends a sample question to that engine only, with no fallback, and shows the answer, model, time and any error.', where: 'Console > AI', audience: 'platform' },
      { text: 'Every Ask engine (Groq, Stable Horde, Gemini) has its own Enabled box, and a Use only this engine button switches the others off. An engine that is off is never called, not even as a backup, until you switch it on again.', where: 'Console > AI', audience: 'platform' },
    ],
  },
  {
    version: 'v1.79', date: '2026-11-08', title: 'Console: Which model does what',
    items: [
      { text: 'A new table on the AI page lists every AI purpose (Ask answers, pictures, voice, Creative Studio images, reels and voices, posting) with the engine and model behind it, whether it is on, and when it was last used.', where: 'Console > AI', audience: 'platform' },
    ],
  },
  {
    version: 'v1.78', date: '2026-11-07', title: 'Ask no longer shows AI "thinking" and says why an engine was skipped',
    items: [
      { text: 'If the AI prints its own notes instead of an answer, Ask now discards it, tries the next engine and, if none gives a clean answer, shows the menu path and steps straight from the help guide.', where: 'Ask (the Ask button on every screen)' },
      { text: 'When an engine is skipped or fails (for example Groq has no key or is switched off), Ask says so in a small note under the answer.', where: 'Ask (the Ask button on every screen)' },
    ],
  },
  {
    version: 'v1.77', date: '2026-11-07', title: 'Ask understands Roman Urdu and answers in your language',
    items: [
      { text: 'Ask now understands questions written in Roman Urdu, Urdu and Hindi, finds the right help page (for example Appointments) and replies in the same language. If the guides do not cover a question it now says so instead of guessing.', where: 'Ask (the Ask button on every screen)' },
      { text: 'Console: the Groq card now shows the last reason an engine failed and why one is being skipped.', where: 'Console > AI', audience: 'platform' },
    ],
  },
  {
    version: 'v1.76', date: '2026-11-07', title: 'Ask gets Groq: better answers, pictures and voice',
    items: [
      { text: 'Ask can now answer faster and better through Groq. Tap the picture button to attach a screenshot and ask about it, and the microphone now works in the Android app too.', where: 'Ask (the Ask button on every screen)' },
      { text: 'Console: a Groq card on the AI page (key, on/off, models, test) and an Ask engine order: Groq, Stable Horde and Gemini can be ranked, and each can be off. If Groq is busy, Ask moves to the next engine.', where: 'Console > AI', audience: 'platform' },
    ],
  },
  {
    version: 'v1.75', date: '2026-11-07', title: 'Speak to Ask and have answers read aloud',
    items: [
      { text: 'Ask now has a microphone button: tap it, speak your question and it is sent. Choose English, Urdu, Arabic, Hindi, French or Spanish. Every answer has a Listen button, and you can tick Read answers aloud. Works in Chrome and Edge; where a browser cannot listen, use your keyboard microphone.', where: 'Ask (the Ask button on every screen)' },
    ],
  },
  {
    version: 'v1.74', date: '2026-11-06', title: 'Watch videos in the content calendar',
    items: [
      { text: 'Posts with a video now have a Watch video button that plays it right in the page (works on phones, vertical and wide videos). Posts with only an image have Preview image. Esc or the Back button closes it.', where: 'Super Admin console > Content calendar > Posts', audience: 'platform' },
    ],
  },
  {
    version: 'v1.73', date: '2026-11-06', title: 'Lead scoring and a follow-up queue',
    items: [
      { text: 'Lead Scoring ranks your open leads hot, warm or cold with the reasons, and a follow-up queue lists overdue follow-ups, follow-ups due today and warm leads that have gone quiet. Call or schedule a reminder from the row.', where: 'CRM > Lead Scoring (where your plan allows it)', guide: 'lead-scoring' },
      { text: 'Plan & billing can now show a 6-month billing period beside monthly and yearly, and extra users and AI credit top-up packs can be added when you pay.', where: 'Settings > Plan & billing' },
      { text: 'Console: seven new hidden plans, Solo Agent to Enterprise, with 6-month and yearly prices, per-plan feature switches the server enforces, extra-user and AI top-up add-ons, and one switch to put the ladder on sale or take it off again.', where: 'Console > Plans', audience: 'platform' },
    ],
  },
  {
    version: 'v1.72', date: '2026-11-06', title: 'Download videos from the content calendar',
    items: [
      { text: 'Posts that have a video or image now have a Download button, so the social media manager can save the file and post it by hand. The file is named after the post and its shape, for example promo-video-instagram-reels-9x16.mp4.', where: 'Super Admin console > Content calendar > Posts', audience: 'platform' },
    ],
  },
  {
    version: 'v1.71', date: '2026-11-03', title: 'Plans with credits and posting limits, and a launch offer',
    items: [
      { text: 'Your plan page now shows your plan, AI credits left, posts left today and this month, emails left and the longest reel your plan allows, with an Upgrade button.', where: 'Settings > Plan & billing', guide: 'plan-credits-limits' },
      { text: 'Reels can be 8, 16 or 24 seconds depending on your plan, and your plan sets how many posts you can publish a day and a month. You see a clear message and an upgrade option when a limit is reached.', where: 'Creative Studio and Content Calendar', guide: 'plan-credits-limits' },
      { text: 'Launch offer: new customers pay a lower price for their first months. The offer, the end date and the monthly price afterwards are shown on the pricing page before you choose.', where: 'Pricing page and Plan & billing', guide: 'plan-credits-limits' },
      { text: 'Prices are now available in Pakistani rupees, US dollars, pounds and Canadian dollars.', where: 'Pricing page' },
      { text: 'Console: three content tiers (Small realtor, Growth, Pro) with credits per country, posting caps, reel length, email caps and feature switches, edited in Plans. They start hidden until you switch them on.', where: 'Console > Plans', audience: 'platform' },
      { text: 'Console: a Plan margins page shows each price against the estimated cost (AI, storage, server, email, payment fees, tax and a commission estimate), with orange and red warnings.', where: 'Console > Plan margins', audience: 'platform' },
      { text: 'Console: a Launch offer page switches the offer on or off, sets the discount and months per country, the banner text, an optional end date and founding spots, with a live preview. The banner, crossed-out prices and checkout all follow it.', where: 'Console > Launch offer', audience: 'platform' },
      { text: 'Console: Zernio automatic posting now defaults to each workspace connecting its own Zernio account, so it is not part of plan costs.', where: 'Console > Social posting', audience: 'platform' },
    ],
  },
  {
    version: 'v1.70', date: '2026-11-03', title: 'Content Calendar: approval and automatic posting',
    items: [
      { text: 'Posts now move through Draft, Waiting approval, Approved, Scheduled and Posted. Only someone with approval rights can approve, and each post shows who approved it.', where: 'Content Calendar', guide: 'content-calendar-posting' },
      { text: 'Where your plan allows it, approved posts publish to your Facebook Page and Instagram by themselves at the chosen time. A failed post shows the reason and a Retry button.', where: 'Content Calendar > Connected accounts', guide: 'content-calendar-posting' },
      { text: 'Drag a post to another day, and use the new week view to see a week in detail.', where: 'Content Calendar', guide: 'content-calendar-posting' },
      { text: 'Send a picture, story or video from Creative Studio to the calendar in one click.', where: 'Creative Studio > My creations', guide: 'content-calendar-posting' },
      { text: 'Console: a Social posting page holds the Zernio key, the billing mode, posting limits, the webhook and the workspaces switched on, plus your own accounts for testing.', where: 'Console > System > Social posting', audience: 'platform' },
    ],
  },
  {
    version: 'v1.69', date: '2026-11-03', title: 'Creative Studio: finished reels with the voice inside',
    items: [
      { text: 'Reels now come as one finished video with the voice inside, instead of a video and a separate audio file.', where: 'Creative Studio > Video reels', guide: 'creative-studio' },
      { text: 'Choose a reel length of 8, 16 or 24 seconds. The credit cost is shown before you confirm and grows with the length.', where: 'Creative Studio > Video reels', guide: 'creative-studio' },
      { text: 'Pick how the voice works: your exact script in English or Urdu, which you can listen to first, or a quick option where the video speaks the line itself.', where: 'Creative Studio > Video reels', guide: 'creative-studio' },
      { text: 'Console: Reel video tools show whether video joining is ready, and a Voice test lab lets the team try Punjabi privately.', where: 'Console > AI', audience: 'platform' },
    ],
  },
  {
    version: 'v1.68', date: '2026-11-02', title: 'A guided tour of the app',
    items: [
      { text: 'The first time you sign in, a short tour points out the search box, the menu, Ask, notifications and appearance. Press Skip any time; it will not start again on your other devices.', where: 'First sign-in', guide: 'product-tour' },
      { text: 'Press the question-mark button at the top of the screen to take the tour again. Creative Studio has its own short tour the first time you open it.', where: 'Top bar > Take the tour', guide: 'product-tour' },
    ],
  },
  {
    version: 'v1.67', date: '2026-11-02', title: 'Ask answers more questions from our guides',
    items: [
      { text: 'When Ask cannot match your question to your data or a guide, it now looks through our help guides and writes a step-by-step answer in your language (English, Urdu or Roman Urdu). It only answers from the guides, says so when it cannot find something, and shows a Watch button when a training video exists.', where: 'Ask button', guide: 'ask-ai-help' },
      { text: 'You can ask follow-up questions in the same chat, and a Report button under AI-written answers lets you flag anything wrong.', where: 'Ask button' },
    ],
  },
  {
    version: 'v1.66', date: '2026-11-02', title: 'Creative Studio: video reels with voice-over',
    items: [
      { text: 'Make a short vertical video reel (8 seconds) from a description, with an optional English or Urdu voice-over. You see the credit cost first and confirm it. The reel is made in the background, you can leave the page, and you get a notification when it is ready. If it fails, your credits are returned.', where: 'Menu > Creative Studio > Video reels', guide: 'creative-studio' },
    ],
  },
  {
    version: 'v1.65', date: '2026-11-02', title: 'Creative Studio: brand stories and post images',
    items: [
      { text: 'New Creative Studio: save your brand once, then have AI write a brand story with captions in English or Urdu and create post images in square, portrait or story size. Save or download what you like.', where: 'Menu > Creative Studio', guide: 'creative-studio' },
      { text: 'Each story or image uses credits from your monthly allowance, and the page shows what is left. A Report button on every result lets you flag anything wrong.', where: 'Menu > Creative Studio' },
    ],
  },
  {
    version: 'v1.64', date: '2026-11-02', title: 'Ask explains how the system works',
    items: [
      { text: 'Ask can now explain how the main flows work from start to finish (lead to sale, installments and receipts, commission, accounting, listing a property, HR and payroll, construction, vendors, the customer portal, your website and access control), and what each role can do.', where: 'Ask button' },
      { text: 'When a training video for the topic has been posted to YouTube, Ask shows a Watch button with its link (only for videos your role may watch).', where: 'Ask button' },
      { text: 'Ask also knows your workspace settings, the default pick-lists such as lead stages and leave types, the chart of accounts, and the options for your country. Try "what does the receipt QR setting do" or "what are the lead stages".', where: 'Ask button' },
    ],
  },
  {
    version: 'v1.63', date: '2026-11-02', title: 'Website assistant knows how property works in your country',
    items: [
      { text: 'The chat assistant on your website can now answer general questions about buying, selling and renting where you work (Pakistan, United States, United Kingdom, UAE and Canada): the usual steps, documents, typical taxes and fees, and home finance. Every such answer says it is general information, not legal, tax or financial advice. Your own answers in the knowledge bank always come first, so add exact local figures there.', where: 'Website > Website Assistant' },
    ],
  },
  {
    version: 'v1.62', date: '2026-11-02', title: 'Ask now knows every screen in the menu',
    items: [
      { text: 'Ask can now tell you where any page or setting is and what it is for, from Dashboard to Audit Log, with a button that opens it. Try "where do I approve leave requests" or "what is the audit log".', where: 'Ask button' },
      { text: 'New step-by-step guides under What\'s new for field location sharing, lead routing and the Lead Conversion report, and follow-up sequences.', where: 'Menu > What\'s new' },
    ],
  },
  {
    version: 'v1.61', date: '2026-11-02', title: 'Step-by-step guides for new features, and Ask can explain them',
    items: [
      { text: 'What\'s new now has a "How to use it" guide under recent features (developer partners, one email per account, maps and Navigate): who it affects, the steps, things to know and common questions.', where: 'Menu > What\'s new' },
      { text: 'Ask can now answer "how do I...", "where is..." and "what changed" questions from these guides, with the steps, where to find it and a link to the training video.', where: 'Ask button' },
      { text: 'New Support knowledge page: every release guide in one searchable place for trainers and support, with support-only notes. New releases must add a guide, a video where it helps, and common questions.', audience: 'platform', where: 'Platform console > System > Support knowledge' },
    ],
  },
  {
    version: 'v1.60', date: '2026-11-01', title: 'Free, smooth street maps and a Navigate button',
    items: [
      { text: 'Maps are now smoother and street-accurate on every device, with no map account needed. Field Coverage shows each agent as a marker that glides to their new position and refreshes about every 15 seconds; on busy teams only the most recent agents are drawn so phones stay fast.', where: 'My Space > Field Coverage', guide: 'maps-navigate' },
      { text: 'The property location pin and the map on public listing pages use the same new map. Searching for a place is faster and kinder to slow connections.', where: 'Properties > Add property; website listing pages' },
      { text: 'New Navigate button on a property and on a visit: it opens Google Maps (or Apple Maps on iPhone and Mac) with directions to the exact spot.', where: 'Properties > a property; Visits; Field Coverage', guide: 'maps-navigate' },
      { text: 'The free map is the default. Google Maps stays available as an option where a Google key is added (MAP_PROVIDER=google); an optional MapTiler key (MAPTILER_API_KEY) adds a Satellite view, and an optional LocationIQ key (LOCATIONIQ_KEY) adds a second place-search source.', audience: 'platform', where: 'Deployment' },
    ],
  },
  {
    version: 'v1.59', date: '2026-11-01', title: 'Live Google Maps for field agents and properties',
    items: [
      { text: 'Field Coverage now shows a live Google map: every agent appears as a marker with their initials and a colour for how fresh the reading is, markers glide to the new position, and the page refreshes about every 15 seconds. Switch between Map and Satellite, zoom to street level, or use Street View.', where: 'My Space > Field Coverage' },
      { text: 'The property location pin and the map on public listing pages use Google Maps for street-accurate results. Where Google Maps is not switched on yet, the existing OpenStreetMap maps keep working.', where: 'Properties > Add property; website listing pages' },
      { text: 'Switching on Google Maps needs a Google Maps browser key on the platform (GOOGLE_MAPS_API_KEY deploy secret).', audience: 'platform', where: 'Deployment' },
    ],
  },
  {
    version: 'v1.58', date: '2026-11-01', title: 'One email, one account',
    items: [
      { text: 'An email address can now belong to only one account. Adding a user, an invitation, an employee, a vendor, a developer or a portal login with an email that is already in use shows "This email already exists" instead of creating a second account. Capital letters and spaces make no difference.', where: 'Settings > Users, HR > Employees, Vendors, Developers', guide: 'one-email-one-account' },
      { text: 'You can still change a user\'s role; the same email just cannot be used for a second role.', where: 'Settings > Users' },
    ],
  },
  {
    version: 'v1.57', date: '2026-11-01', title: 'Developer partners: Plot source on the property form, list fix and a tutorial video',
    items: [
      { text: 'New video in Training videos: "Developer partners (joint-venture plots)" walks through adding a developer and agreement, marking plots as developer plots, selling them and the read-only developer portal. Payment approval by the developer, rebates and cancellations are not part of this update yet.', where: 'Training videos', guide: 'developer-partners' },
      { text: 'The property form now has a Plot source field (Pakistan workspaces with the Developers permission): choose Own, or Developer and then the developer and one of its agreements.', where: 'Properties > Add Property', guide: 'developer-partners' },
      { text: 'The Developers list now shows your developers (it appeared empty after v1.56).', where: 'Developers' },
    ],
  },
  {
    version: 'v1.56', date: '2026-10-31', title: 'Developer partners (joint-venture plots)',
    items: [
      { text: 'New Developers page: record the partner developers whose plots you sell, with an agreement for each (rates, rebate percentages and the cancellation window with its deduction tiers). On a plot, set the source to Developer and choose the developer and agreement.', where: 'Developers', guide: 'developer-partners' },
      { text: 'Selling a developer\'s plot creates a booking ID and keeps the contract out of your revenue: the customer pays the developer, so the sale is held as a pass-through. Direct receipts on these files are switched off until the developer approval step arrives. Your own plots and houses are not affected.', where: 'Sales & Bookings' },
      { text: 'Developers can sign in to their own portal to see the files sold on their plots: booking ID, registration number, plot size, photos, customer name and the payment schedule. Customer CNIC, phone and e-mail are never shown. Create the login from the developer\'s page.', where: 'Developers > developer > Create portal login' },
    ],
  },
  {
    version: 'v1.55', date: '2026-10-31', title: 'Run-from-anywhere promo video in the content calendar',
    items: [
      { text: 'The "Add promo video drafts" button now also adds drafts for the 32-second "run your agency from anywhere" promo, in vertical and horizontal versions for the same channels. Drafts you already have are left as they are. Nothing is posted until you do it.', where: 'Platform console > Content calendar', audience: 'platform' },
    ],
  },
  {
    version: 'v1.54', date: '2026-10-31', title: 'Receipt and partner promo videos in the content calendar',
    items: [
      { text: 'The "Add promo video drafts" button now also adds drafts for the 27-second receipts promo and the 32-second Sync Technologies partner promo, in vertical and horizontal versions for the same channels. The partner drafts are marked ON HOLD and "DO NOT POST" until you confirm the partner has agreed to the use of its logo and name. Drafts you already have are left as they are. Nothing is posted until you do it.', where: 'Platform console > Content calendar', audience: 'platform' },
    ],
  },
  {
    version: 'v1.53', date: '2026-10-31', title: 'Second promo video in the content calendar',
    items: [
      { text: 'The "Add promo video drafts" button now also adds drafts for the short 26-second promo video, in vertical and horizontal versions for the same channels. Drafts you already have are left as they are. Nothing is posted until you do it.', where: 'Platform console > Content calendar', audience: 'platform' },
    ],
  },
  {
    version: 'v1.52', date: '2026-10-31', title: 'Promo videos in the content calendar',
    items: [
      { text: 'New "Add promo video drafts" button: adds draft posts for the Agentify character promo video (vertical for Instagram, TikTok, YouTube Shorts and WhatsApp Status; horizontal for YouTube, LinkedIn, Facebook and X) with captions, hashtags and a public video address. Nothing is posted; review, schedule and publish each one yourself.', where: 'Platform console > Content calendar', audience: 'platform' },
    ],
  },
  {
    version: 'v1.51', date: '2026-10-31', title: 'Shared library, brand groups and AI limits',
    items: [
      { text: 'New Shared library: ready-made contract wording, standard clauses, brochure layouts and email templates kept up to date for every workspace. Read them in place, or choose "Use my own version" to keep your own text for any item. Only your workspace sees your version, and you are told when the shared text has been updated since.', where: 'Documents > Shared library' },
      { text: 'New Brands page: put several workspaces of one owner in a brand group that shares a logo and colour. The logo and colour are applied to every member straight away; data, staff, clients, fees and accounts stay separate in each workspace. A workspace page shows which brand it belongs to.', where: 'Platform console > Workspaces > Brands', audience: 'platform' },
      { text: 'New Template library page to add, edit and retire the shared items, with a note of which workspaces use their own version and whether the shared text has moved on since.', where: 'Platform console > System > Template library', audience: 'platform' },
      { text: 'New Workspace AI controls: a kill switch for all workspaces, a monthly cap on estimated workspace AI spend, on/off switches per AI feature, and an on/off switch and daily call limit per workspace, with calls today and cost this month for each.', where: 'Platform console > Reports & Analytics > AI usage & credits', audience: 'platform' },
    ],
  },
  {
    version: 'v1.50', date: '2026-10-29', title: 'Private files in secure storage',
    items: [
      { text: 'Your private files (documents, payment slips, recordings and content images or videos) are now kept in secure cloud storage, in a folder that only your workspace can reach. Links to open them work for a short time and are only given to signed-in people with access.', where: 'Documents, Payments, Recordings and Content' },
      { text: 'File storage is checked before every upload. At 80% of your plan\'s storage you get an email and a notice, and at 100% new uploads pause with a prompt to delete files or upgrade. Your existing files stay safe.', where: 'Settings > Plan & Billing' },
      { text: 'New Storage & quotas page: used storage against the limit for every workspace, the storage in each plan, a limit for one workspace, and a live count of the storage bucket against its 250 GB total.', where: 'Platform console > Plans & Subscriptions > Storage & quotas', audience: 'platform' },
    ],
  },
  {
    version: 'v1.49', date: '2026-10-28', title: 'Cost and profit report',
    items: [
      { text: 'New Cost & profit page: recognised revenue per workspace and plan against the costs you enter (monthly cost per plan, platform overhead) and AI recorded with Agentify\'s key, with margin and net profit. Figures that cannot be worked out, such as a missing cost or exchange rate, show a dash and are listed instead of guessed.', where: 'Platform console > Reports & Analytics > Cost & profit', audience: 'platform' },
    ],
  },
  {
    version: 'v1.48', date: '2026-10-28', title: 'AI usage and credits',
    items: [
      { text: 'New AI usage & credits page: connect Agentify\'s Gemini key, set a monthly budget and the provider prices, and see credits used and left, plus AI use by workspace, by subscription plan and by purpose. Costs are estimates from the prices you enter.', where: 'Platform console > Reports & Analytics > AI usage & credits', audience: 'platform' },
      { text: 'The Content calendar can draft a post with AI from a short brief, within a daily limit and the monthly budget. Drafts are marked as AI drafts and are never scheduled automatically.', where: 'Platform console > Marketing > Content calendar', audience: 'platform' },
    ],
  },
  {
    version: 'v1.47', date: '2026-10-28', title: 'Content calendar for social posts',
    items: [
      { text: 'New Content calendar: plan, schedule and record Agentify\'s own social posts, with a month view, Not yet posted and Posted lists, posting limits (per day, per channel, gap and hours) and the next time a post can go out. Scheduling is refused when a limit would be broken and names the next free time.', where: 'Platform console > Marketing > Content calendar', audience: 'platform' },
      { text: 'New Social Media Manager console role: can use only the Content calendar, with no access to billing, workspaces or settings. Only a Super Admin can change the limits.', where: 'Platform console > Console users & roles', audience: 'platform' },
    ],
  },
  {
    version: 'v1.46', date: '2026-10-28', title: 'Phone and receipt fixes',
    items: [
      { text: 'On a receipt voucher the QR code no longer covers the Next due date; on a narrow screen it moves below the ledger summary. In dark mode the ledger summary on a phone is readable again.', where: 'Accounting > Receipt Vouchers' },
      { text: 'The current page is highlighted in the menu, including on pages opened from a list (for example a lead).', where: 'Menu and bottom tabs' },
      { text: 'The website menu on a phone reads correctly in dark mode, the demo tab strip scrolls sideways instead of wrapping, and headings and text are a little smaller on small screens.', where: 'Website, mobile app' },
    ],
  },
  {
    version: 'v1.45', date: '2026-10-28', title: 'Console sign-in: show password and reset',
    items: [
      { text: 'The console sign-in page has an eye button to show or hide the password you type, and a Reset password link that emails a one-time link (valid for 30 minutes) to choose a new password. Resetting signs out other sessions; two-factor sign-in stays on.', where: 'Platform console sign-in', audience: 'platform' },
    ],
  },
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
      { text: 'Build follow-up sequences of emails and tasks from ready templates. They stop when the customer replies, books a viewing, opts out or the lead closes, and wait if there is no verified sender or allowance.', where: 'CRM > Follow-up Sequences', guide: 'follow-up-sequences' },
      { text: 'See how leads convert from enquiry to response, viewing and sale, with the numbers each percentage is based on.', where: 'CRM > Lead Conversion', guide: 'lead-routing-conversion' },
    ],
  },
  {
    version: 'v1.14', date: '2026-10-26', title: 'Send email from your own address',
    items: [
      { text: 'Verify your company domain and create sender addresses so appointment reminders and follow-ups come from you. Only verified addresses can send.', where: 'Settings > Email', guide: 'follow-up-sequences' },
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
      { text: 'Field agents can choose to share their location while working. Managers see a coverage view. It is off until an admin switches it on, and employees see a consent notice first.', where: 'My Space > My Location, Field Coverage', guide: 'field-location' },
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
