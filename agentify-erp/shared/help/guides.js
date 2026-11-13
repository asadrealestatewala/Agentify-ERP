// Step guides, FAQs and known limits for what each release added. One source for: What's new (Guide links), the
// console's Support knowledge base (training + customer support), and the Ask assistant's "how do I ..." answers.
// A changelog item points at a guide with `guide: 'key'`. `video` is the key of a training video (server/assets/training/manifest.json
// or the console's Training videos library). Write for customers: plain words, no mention of the console or platform admins
// in tenant guides (shared/test enforces this). `internal` lines are for support staff only and never reach a workspace.
import { CHANGELOG, tenantChangelog } from '../changelog.js';
import { SCREENS } from '../screens.generated.js';
import { SCREEN_NOTES } from '../screenNotes.js';

export const GUIDES = {
  'learn-the-system': {
    title: 'Training: learn the whole system', since: 'v1.99', module: 'Training videos',
    who: 'Everyone who works in the workspace, especially new staff',
    keywords: ['training', 'train', 'learn', 'learning', 'tutorial', 'tutorials', 'video', 'videos', 'onboarding', 'tour', 'course', 'whole system', 'portal', 'beginner', 'seekhna', 'tarbiyat', 'ٹریننگ', 'تربیت', 'تدريب'],
    steps: [
      'Open Training videos in the menu. It lists the short videos for your role; watch them in order to learn each part of the system.',
      'Press the question-mark button (Take the tour) at the top of any page. A guided tour points out the main parts of the screen you are on.',
      'Ask any "how do I ..." question in Ask (the lightning button at the top), in English, Urdu or Roman Urdu. It answers from our help guides with the menu path and steps.',
      'Still stuck? Open Help & Support in the menu and press New ticket; our team replies there.',
    ],
    limits: ['You see the training videos meant for your role. Administrators can assign videos to roles.', 'Tours only show the parts of a screen your role can use.'],
    faq: [
      { q: 'How do I get training for the whole system?', a: 'Open Training videos in the menu and watch the videos for your role, then use Take the tour (question-mark button at the top) on each screen.' },
      { q: 'Can I see the tour again?', a: 'Yes. Press the question-mark button (Take the tour) at the top of the page any time.' },
    ],
    internal: ['Added so Ask can answer general "how do I learn the system / training" questions, including Roman Urdu ones.'],
  },
  'support-desk': {
    title: 'Help & Support: send a ticket and follow the replies', since: 'v1.98', module: 'Help & Support',
    who: 'Everyone who works in the workspace',
    keywords: ['support', 'help', 'ticket', 'complaint', 'problem', 'bug', 'contact', 'madad', 'سپورٹ', 'دعم', 'assistance'],
    steps: [
      'Open Help & Support in the menu. The page shows your tickets, newest change first.',
      'Press New ticket. Write a short subject, pick a category and a priority, then describe what happened, what you were doing and which page you were on.',
      'Attach up to 3 pictures or PDF files, 450 KB each, if a screenshot helps.',
      'Press Send ticket. You get an e-mail with the ticket number and the time we aim to reply by.',
      'Open the ticket any time to read our replies, add more details or files, and reply to us.',
      'When the problem is gone, press Mark as solved. If it comes back, press Reopen and we pick it up again.',
      'Use the Language box to read the page and get e-mails in your own language: English everywhere, Urdu in Pakistan, Arabic in the UAE and French in Canada.',
    ],
    limits: [
      'Urgent is for work that has stopped. Everything else should be Normal or High so urgent tickets stay visible.',
      'You can send 5 new tickets an hour; add to an open ticket instead of starting another.',
      'Only pictures (PNG, JPG, WebP) and PDF files can be attached, 450 KB each.',
      'A closed ticket cannot be replied to; start a new ticket instead.',
      'You see your own tickets. An administrator in your workspace sees every ticket raised from it.',
    ],
    faq: [
      { q: 'How quickly will I get a reply?', a: 'The ticket shows the time we aim to send the first reply by; urgent tickets are answered first.' },
      { q: 'Can I write in Urdu or Arabic?', a: 'Yes. Pick your language at the top of the page and write in it; the page and your e-mails follow that choice.' },
      { q: 'Is my message private?', a: 'It travels over a secure HTTPS connection and is read only by you, your workspace administrator and the Agentify support team.' },
    ],
    internal: ['Tickets live in the platform database (support_tickets/support_messages/support_files), so the console sees every workspace while each workspace sees only its own rows.',
      'Console > Support > Support desk: reply, internal notes, priority, assignee, status and the reply targets per priority. First-reply and solve clocks are plain clock time from when the ticket was raised.',
      'New-ticket and customer-reply alerts go to the address in Reply targets and alerts (support_notify_email), falling back to PLATFORM_SUPPORT_EMAIL.'],
  },
  'sign-in-security': {
    title: 'Sign-in protection: account lock, 2FA codes and password rules', since: 'v1.94', module: 'Sign in',
    who: 'Everyone who signs in to the workspace, the customer portal and the vendor and developer portals',
    keywords: ['locked', 'lock', 'password', 'sign in', 'login', 'two-factor', '2fa', 'authenticator', 'sign out', 'logout', 'security'],
    steps: [
      'After 10 wrong passwords or authenticator codes in 15 minutes, the account is locked for 15 minutes, even for the right password. The sign-in page says so.',
      'Wait 15 minutes, or use Forgot password on the sign-in page to choose a new password by e-mail.',
      'On the authenticator code step, five wrong codes end that attempt. Enter your password again to get a fresh step.',
      'Pressing Sign out now ends that session for good. Your other phones and computers stay signed in; use Sign out of every device under your profile to end them too.',
      'New passwords must have at least 8 characters, must not be a very common password such as 12345678 or Password123, and must not be your e-mail address or name.',
    ],
    limits: ['The lock covers the account, not one browser, so a person guessing from many places is stopped too.', 'An administrator who sets a new password for someone also signs that person out everywhere.'],
    faq: [
      { q: 'I am locked out. What now?', a: 'Wait 15 minutes and try again, or reset your password with Forgot password. A successful sign-in clears the count.' },
      { q: 'Why was my new password refused?', a: 'It is too short, too common, or the same as your e-mail or name. Choose a longer phrase that is not easy to guess.' },
    ],
    internal: ['Lock: 10 failures (login_failures, per user) in 15 minutes; LOGIN_LOCK_LIMIT can change the number. Failures older than 15 minutes stop counting.',
      'Sign out stores the token id in revoked_tokens until it expires; other sessions keep working.'],
  },
  'plan-credits-limits': {
    title: 'Your plan: credits, posting limits and the launch offer', since: 'v1.71', module: 'Plan & billing',
    who: 'People who can see Settings; changing plan needs permission to edit settings',
    keywords: ['plan', 'upgrade', 'credits', 'allowance', 'quota', 'launch', 'offer', 'discount', 'tier'],
    steps: [
      'Open Settings, then Plan & billing. The Your plan card at the top shows your AI credits, posts today, posts this month, the mail allowance and the longest video your plan allows.',
      'A bar fills as you use something. When it is full, that action waits or is refused until the next day or month, or until you upgrade.',
      'Press Upgrade to jump to the plan list, compare plans and choose one.',
      'If a launch offer is running for your country, the pricing page and the plan list show the normal price crossed out, the launch price, how many months it lasts and the price after that.',
    ],
    limits: ['Credits renew every month. Posts and video length follow your plan.', 'The launch offer applies to monthly billing for the first months only, and only to new paying customers.'],
    faq: [
      { q: 'What happens when my credits run out?', a: 'AI actions that cost credits stop until next month. Everything else keeps working. Upgrade for a bigger allowance.' },
      { q: 'Does the launch price last forever?', a: 'No. It applies for the number of months shown on the pricing page, then the normal monthly price starts. The page states the normal price before you pay.' },
      { q: 'Why can I only make short videos?', a: 'The longest video depends on your plan. A higher plan allows 16 or 24 seconds.' },
    ],
    internal: ['Plan numbers live in the console Plans page (content allowances section) and the offer in the Launch offer page. Credits come from the plan unless the workspace has its own override on its detail page.'],
  },
  'content-calendar-posting': {
    title: 'Content Calendar: approval and automatic posting', since: 'v1.70', module: 'Content Calendar',
    who: 'People with the Content permission; approvers need the Approve permission; shown where posting is switched on for the workspace',
    keywords: ['content', 'calendar', 'post', 'posts', 'schedule', 'facebook', 'instagram', 'publish', 'social', 'connect', 'account', 'retry', 'failed', 'drag', 'week'],
    steps: [
      'Open Content Calendar. Press Connected accounts and connect your Facebook Page and Instagram. Instagram must be a business or creator account.',
      'Press New post, write the caption, add a picture or video, choose the connected accounts, and set the date and time.',
      'Press Send for approval. Someone with approval rights presses Approve (or Send back with a reason). Every approved post shows who approved it.',
      'Once approved, a post with an account and a time shows as Scheduled and publishes by itself at that time. Posted means it is live.',
      'To move a post, drag it to another day in the month or week view, or change the date in the post.',
      'In Creative Studio, press Send to calendar on a picture, story or video to add it here as a draft.',
      'If a post fails, open it to read the reason and press Retry.',
    ],
    limits: ['Instagram posts need a picture or video. Each connected Instagram account can publish a limited number of posts in any 24 hours (25 to start); a post over the limit stays Scheduled and goes out when the limit allows.', 'Changing the words, the media or the accounts of an approved post sends it back for approval; changing only the date or time does not.', 'Facebook and Instagram only for now.', 'Your plan may limit the posts per day and per month.'],
    faq: [
      { q: 'Why is nothing posting by itself?', a: 'Posting through the calendar must be switched on for your workspace, a Facebook or Instagram account must be connected, and the post must be approved with an account and a time. Otherwise use the Post button to publish it by hand and tick it off.' },
      { q: 'Can I sign off my own post?', a: 'Yes, if your role has approval rights. The post still shows who approved it.' },
      { q: 'Why does it say a post is waiting?', a: 'Either it needs approval, or the account has reached its posting limit for 24 hours. The message under the status says which.' },
    ],
    internal: ['Zernio is the posting service. Console > Social posting holds the key, billing mode, per-account limits, the webhook and the list of workspaces switched on. Posts are sent by a one-minute tick; Retry sends only the accounts that did not succeed.'],
  },
  'product-tour': {
    title: 'Guided tour: find your way around', since: 'v1.68', module: 'Getting started',
    who: 'Everyone, the first time they sign in; any time from the Take the tour button',
    keywords: ['tour', 'guided tour', 'walkthrough', 'welcome', 'getting started', 'new user', 'show me around', 'help', 'first time', 'onboarding', 'replay'],
    steps: [
      'The first time you sign in, a short tour points out the search box, the menu, Ask, notifications and appearance. Press Next to move on or Skip to close it.',
      'To see it again, press Take the tour (the question-mark button at the top of the screen). On a page that has its own tour, such as Creative Studio, it plays that page\'s tour.',
      'The tour only shows parts you can use. Anything hidden by your role or your plan is skipped.',
      'The tour remembers that you have seen it on your account, so it does not start again on your other devices.',
    ],
    limits: ['The tour never changes any data; it only points at parts of the screen.', 'On a phone it points at the menu button and bottom tabs instead of the side menu.'],
    faq: [
      { q: 'How do I see the tour again?', a: 'Press Take the tour at the top of the screen. It replays the tour for the page you are on.' },
      { q: 'The tour started and I do not want it.', a: 'Press Skip (or Escape). It will not start again on its own.' },
    ],
    internal: ['Tour steps live in shared/help/tours.js; the seen flag is saved per user (users.tour_seen). Bump a tour\'s version to show it to everyone again.'],
  },
  'ask-ai-help': {
    title: 'Ask: AI answers from our guides', since: 'v1.67', module: 'Ask',
    who: 'Everyone who can use Ask; shown where AI is switched on for the workspace',
    keywords: ['ask', 'assistant', 'ai', 'answer', 'answers', 'help', 'guide', 'guides', 'follow-up', 'report', 'urdu', 'roman urdu', 'question'],
    steps: [
      'Open Ask (the button at the bottom right, or the Ask button on your phone) and type your question in your own words.',
      'Questions about your numbers are answered from your live data as before. Questions about how to do something are answered from our guides.',
      'If a guide covers your question, Ask writes the steps in plain language, in the language you used. An AI-written answer says so and lists the guides it used.',
      'Ask a follow-up in the same chat, such as "and how do I do that for a customer?". Ask remembers the last few questions.',
      'If an AI-written answer is wrong or confusing, press Report under it.',
    ],
    limits: ['AI answers come only from our guides and never invent menus; when nothing matches, Ask says it could not find it.', 'AI answers never use your business data, and your role decides which videos are shown.', 'Ask may pause AI answers for a while if the AI allowance is used up; your data questions keep working.'],
    faq: [
      { q: 'Why did Ask say it could not find the answer?', a: 'The guides do not cover that yet. Try different words, or ask your administrator or support.' },
      { q: 'Can I ask in Urdu?', a: 'Yes. Ask replies in the language you write in, including Roman Urdu.' },
    ],
    internal: ['Calls use the ask_assistant feature in the console AI page (switch, daily limit, budget). Reports land in Reported AI answers.'],
  },
  'creative-studio': {
    title: 'Creative Studio: brand story, post images and video reels', since: 'v1.66', module: 'Creative Studio',
    who: 'Roles with the Content permission, in workspaces where AI is switched on and credits are left',
    keywords: ['creative', 'studio', 'brand story', 'caption', 'captions', 'post', 'image', 'images', 'social media', 'instagram', 'facebook', 'credits', 'ai', 'urdu', 'report'],
    steps: [
      'Open Creative Studio from the menu. If you do not see it, AI is off for your workspace or this month\'s credits are used up.',
      'On Brand profile, check your brand name, business type, tone and colors, add a short true description of your business, then Save. It starts from your Branding settings.',
      'On Brand story, choose English or Urdu, optionally say what the story should focus on, and write it. You get a story and three captions to copy.',
      'On Post images, describe the post, choose Square, Portrait or Story size and how many options, then create. Save the ones you like or Download them.',
      'On Video reels, choose a length (8, 16 or 24 seconds) and describe the reel. For longer reels you can write one line for each 8-second part so the parts match.',
      'Choose how the voice works. Exact script (best for ads): type your words in English or Urdu, press Hear the voice to listen and check it fits, and the voice is put inside the finished video. The quick way lets the video itself speak your line, but the voice and words can vary, especially in Urdu.',
      'Read the cost warning, confirm it, and leave the page. You are notified when the reel is ready. You get one finished video with the voice inside, which you can play, download or delete.',
      'Saved images and every brand story are kept under My creations. If a result is wrong or unsuitable, press Report.',
    ],
    limits: ['A story costs 1 credit and each image 3 credits; credits reset every month and the page shows what is left.', 'Requests for harmful, illegal or deceptive content are refused and cost nothing.', 'A reel costs 8 credits per second of video, so 8, 16 and 24 seconds cost 64, 128 and 192, plus 1 credit per 100 characters of an exact-script voice. The script can have up to 600 characters per 8 seconds. If video joining is not available on the server, reels are 8 seconds and the voice comes as a separate file.', 'You can have 2 reels being made at once.', 'Send to calendar (on My creations) adds a picture, story or video to the Content Calendar as a draft.'],
    faq: [
      { q: 'Why is Creative Studio missing from my menu?', a: 'It only shows when AI is switched on for your workspace and you still have credits this month. Contact support to top up or switch AI on.' },
      { q: 'Does the AI invent facts about my business?', a: 'It is told to use only what you saved in the brand profile and your description. Check every result before posting and use Report if something is wrong.' },
      { q: 'Does hearing the voice cost credits?', a: 'Yes, the voice credits, once. If you then make the reel with the same script and language, you are not charged for the voice again.' },
      { q: 'My reel failed. Did I lose credits?', a: 'No. A reel that fails or is refused is refunded in full, and you are notified.' },
      { q: 'Where are my images kept?', a: 'Saved images go to your workspace\'s own file storage and count toward your storage limit. Unsaved options disappear when you leave the page.' },
    ],
    internal: ['Reels are built with ffmpeg on the server (installed by the deploy). Console > AI shows whether it is ready; without it only 8-second reels with a separate voice file are possible. Punjabi is tested in the console Voice test lab and is not offered to workspaces.', 'Credits are set per workspace (or by default) in the console AI page; a refused or blocked request is not charged.', 'Reports appear in the console AI page under Reported AI answers.'],
  },
  'developer-partners': {
    title: 'Developer partners (joint-venture plots)', since: 'v1.56', module: 'Developers', video: 'developer-partners',
    who: 'Admin and roles with the Developers permission; Pakistan workspaces',
    keywords: ['developer', 'developers', 'joint venture', 'jv', 'plot', 'plots', 'agreement', 'rebate', 'portal', 'booking id', 'pass-through'],
    steps: [
      'Open Developers and choose Add developer. Enter the developer and its agreement: rates, rebate percentages and the cancellation window with its deduction tiers.',
      'Open Properties > Add Property (or edit a plot) and set Plot source to Developer. Choose the developer and one of its agreements.',
      'Sell the plot from Sales & Bookings as usual. A booking ID is created and the sale is held as a pass-through, so it is not counted as your revenue.',
      'To give the developer a read-only view, open Developers > the developer > Create portal login.',
    ],
    limits: ['Direct receipts on developer files are switched off until the developer approval step arrives.', 'Payment approval by the developer, rebates and cancellations are not part of the product yet.', 'The developer portal never shows customer CNIC, phone or e-mail.'],
    faq: [
      { q: 'Why is a developer plot sale not in my revenue?', a: 'The customer pays the developer, so the sale is held as a pass-through and kept out of your revenue.' },
      { q: 'The Developers list is empty.', a: 'This was fixed in v1.57. Refresh the page; your developers now appear.' },
      { q: 'I cannot find Plot source on the property form.', a: 'It appears for Pakistan workspaces whose role has the Developers permission (added in v1.57).' },
    ],
    internal: ['If Plot source is missing, check the workspace region is Pakistan and the role has the Developers permission.'],
  },
  'one-email-one-account': {
    title: 'One email, one account', since: 'v1.58', module: 'Settings',
    who: 'Admins adding users, employees, vendors and developers',
    keywords: ['email', 'already exists', 'duplicate', 'second account', 'same email', 'invite'],
    steps: ['Use a different email address for each person or company.', 'To change someone\'s role, edit the existing user (Settings > Users) instead of adding them again.'],
    limits: ['Capital letters and spaces make no difference when emails are compared.'],
    faq: [{ q: 'I see "This email already exists".', a: 'That address is already used by another account, employee, vendor, developer or invitation. Use another address or edit the existing record.' }],
    internal: ['Search all login types for the address before telling a tenant it is free.'],
  },
  'field-location': {
    title: 'Field agent location sharing and coverage', since: 'v1.6', module: 'My Space', video: 'field-coverage-admin',
    who: 'Field staff share; managers and HR read the coverage view',
    keywords: ['location sharing', 'share location', 'field coverage', 'field agent', 'tracking', 'consent', 'gps', 'coverage'],
    steps: [
      'An administrator switches location sharing on for the workspace. It stays off until they do.',
      'Each employee sees a consent notice first. In My Space > My Location they choose when to share and can stop at any time.',
      'Managers open My Space > Field Coverage to see which agents shared recently and where.',
    ],
    limits: ['Only people who agreed to the notice can be seen, and only while they share.', 'Two training videos cover this: one for administrators and HR, one for field staff.'],
    faq: [{ q: 'Why does an agent not appear on Field Coverage?', a: 'They have not agreed to the notice, have stopped sharing, or location sharing is not switched on for the workspace.' }],
    internal: ['Offline readings are queued on the phone and sent when the connection returns.'],
  },
  'basics-add-lead': {
    title: 'Add a lead', since: 'v1.0', module: 'CRM',
    who: 'Sales agents and managers',
    keywords: ['add lead', 'new lead', 'create lead', 'enter lead', 'add contact', 'new contact', 'add enquiry'],
    steps: [
      'Open CRM > Leads in the menu and press Add Contact (top right).',
      'Fill in the name and phone number. Email, address and notes are optional.',
      'Under CRM information choose the lead source, lead stage, priority and, if you wish, the assigned sales agent, interested project and follow-up date.',
      'Press Save. The lead appears in the Leads list and on the assigned agent\'s follow-up list.',
    ],
    limits: ['Agents who only see their own records are the assigned agent automatically.', 'To add many leads at once use Import on the Contacts page.'],
    faq: [{ q: 'Where do I see my new lead?', a: 'In CRM > Leads. Search by name or phone.' }],
    internal: [],
  },
  'basics-schedule-appointment': {
    title: 'Schedule an appointment or site visit', since: 'v1.0', module: 'CRM',
    who: 'Sales agents and managers',
    keywords: ['appointment', 'add appointment', 'schedule appointment', 'book appointment', 'site visit', 'schedule visit', 'meeting with client', 'visit'],
    steps: [
      'Open CRM > Appointments in the menu and press Schedule a visit.',
      'Choose the lead or customer, the property or project, the date and time, and the agent who will go.',
      'Press Save. The visit shows in the Appointments list and the person is reminded before it starts.',
    ],
    limits: ['You need permission to edit CRM records to schedule a visit.'],
    faq: [],
    internal: [],
  },
  'basics-add-property': {
    title: 'Add a property', since: 'v1.0', module: 'Properties',
    who: 'Property managers and administrators',
    keywords: ['add property', 'new property', 'create property', 'add listing', 'new listing', 'add unit', 'add plot', 'add house', 'add flat'],
    steps: [
      'Open Properties > Inventory and press Add property, or open Properties > Add Property directly.',
      'Fill in the title, project, type, size, price and location. Add photos and documents if you have them.',
      'Press Save as draft to keep working later, or Save & publish if your role may approve listings. Otherwise it goes to Listing Approvals.',
    ],
    limits: ['Draft properties are not shown on your website until they are published.'],
    faq: [],
    internal: [],
  },
  'basics-installment-plan': {
    title: 'Sell a property on a payment plan', since: 'v1.0', module: 'Customers, Payments',
    who: 'Sales and accounts staff',
    keywords: ['installment plan', 'create installment', 'create installments', 'make installments', 'payment plan', 'new property sale', 'new sale'],
    steps: [
      'Open Customers > Sales & Bookings and press New property sale.',
      'Choose the customer and property, then enter the sale price, discount, booking amount and advance (if any).',
      'Enter how many monthly payments there will be and the first due date. The preview shows each due date and amount before you save. Add balloon payments if the plan has them.',
      'Press Create. The schedule appears under Payments > Installments. When money comes in, record it with a receipt voucher.',
    ],
    limits: ['The schedule is fixed once the sale is confirmed; edit the sale rather than a single payment.'],
    faq: [],
    internal: [],
  },
  'basics-receipt-voucher': {
    title: 'Create a receipt voucher', since: 'v1.0', module: 'Receipt Vouchers',
    who: 'Accounts staff',
    keywords: ['create voucher', 'receipt voucher', 'create voucher', 'new receipt', 'record payment', 'new expense voucher'],
    steps: [
      'Open Accounting > Receipt Vouchers and press New receipt. (For money you spent, open Accounting > Expense Vouchers and press New expense voucher.)',
      'Choose the customer and, if the payment is for a sale, the sale or payment.',
      'Enter the amount, date and how it was paid (cash, bank or cheque).',
      'Press Submit. You can then download the voucher as a PDF from its page.',
    ],
    limits: ['You need permission to create payments or accounting entries.'],
    faq: [],
    internal: [],
  },
  'edit-bank-accounts': {
    title: 'Edit bank, cash and other accounts', since: 'v1.92', module: 'Accounting',
    who: 'Accounts staff and administrators',
    keywords: ['edit bank account', 'rename bank account', 'opening balance', 'change opening balance', 'delete account', 'main bank account', 'chart of accounts'],
    steps: [
      'Open Accounting > Chart of Accounts.',
      'Find the account (for example Main Bank Account) and press Edit.',
      'Change the name and, if needed, the opening balance, then press Save. Only the difference is posted against Capital, so your books stay balanced.',
      'To remove an account you never use, press Delete. It must have no transactions and no sub-accounts.',
    ],
    limits: ['Accounts that receipts, expenses and payroll post to automatically can be renamed but not deleted or deactivated.', 'You need Accounting edit or delete permission.'],
    faq: [],
    internal: ['Opening balance changes are journal entries with source "opening". Deleting an account removes its opening entry only.'],
  },
  'lead-routing-conversion': {
    title: 'Lead routing and the Lead Conversion report', since: 'v1.15', module: 'Settings, CRM',
    who: 'Sales managers and administrators',
    keywords: ['lead routing', 'assign leads', 'round robin', 'weighted', 'duplicate', 'duplicates', 'merge', 'response time', 'conversion', 'who gets the lead', 'unassigned'],
    steps: [
      'Open Settings > Lead Routing and add rules. They are checked in order and the first match wins. A rule can match source, city, property type and project.',
      'Choose how a rule shares leads: round robin or weighted. Only active, available agents on the rule\'s team who are under their open-lead limit are chosen.',
      'If nobody is eligible the lead goes to the rule\'s fallback owner, then the workspace default owner, then the sales manager. Otherwise it waits unassigned and the manager is told.',
      'Open CRM > Lead Conversion to see how leads move from enquiry to response, appointment and won, with the counts behind each percentage.',
    ],
    limits: ['Saving or switching on a rule never moves leads that are already assigned.', 'A repeat enquiry from someone already in the CRM keeps their owner.', 'Two enquiries that share a phone or email but have different names stay separate until a manager reviews and merges them under Lead Routing > Duplicates.'],
    faq: [{ q: 'Why did a lead not go to the agent I expected?', a: 'Rules run in order and an agent must be available, on the rule\'s team and under their open-lead limit.' }, { q: 'A conversion rate shows a dash.', a: 'There is nothing to measure yet, so no percentage is shown.' }],
    internal: ['Assignment is written in one database transaction so simultaneous leads cannot read the same round-robin position.'],
  },
  'lead-scoring': {
    title: 'Lead scoring and the follow-up queue', since: 'v1.73', module: 'CRM',
    who: 'Sales agents and managers on plans that include it (from Agency Pro)',
    keywords: ['lead scoring', 'score', 'hot lead', 'warm lead', 'cold lead', 'follow-up queue', 'follow up queue', 'reminder', 'overdue follow-up', 'who to call first', 'gone quiet'],
    steps: [
      'Open CRM > Lead Scoring. The Follow-up queue tab lists leads whose follow-up is overdue or due today, and warm or hot leads that have gone quiet with nothing scheduled.',
      'Call straight from the row, or choose Remind tomorrow to put a follow-up task on the lead for the next day.',
      'Open the Lead scores tab to see every open lead ranked from 0 to 100. Hot is 65 or more, warm 40 or more. Click Hot, Warm or Cold to filter.',
      'Each score shows the reasons behind it, such as recent activity, the stage, a known budget or a specific property asked about.',
    ],
    limits: ['Scores are worked out when you open the page from what the CRM already holds; they are a guide for who to call first, not a prediction.', 'Lost and won leads, customers and demo contacts are not scored.', 'An agent who sees only their own leads sees only their own scores and queue.'],
    faq: [{ q: 'Why is a lead cold?', a: 'Little recent activity, an early stage or missing details. Logging a call or note, setting a budget or moving the stage raises the score.' }, { q: 'I cannot see Lead Scoring.', a: 'It is part of Agency Pro and the plans above it. An administrator can upgrade under Settings > Plan & Billing.' }],
    internal: ['Computed on demand in services/leadScoring.js; nothing is stored. The plan gate is the lead_scoring feature in services/plans.js FEATURE_GATES.'],
  },
  'follow-up-sequences': {
    title: 'Follow-up sequences', since: 'v1.15', module: 'CRM',
    who: 'Sales teams that email or message leads automatically',
    keywords: ['sequence', 'sequences', 'follow-up', 'follow up', 'drip', 'automatic email', 'nurture', 'reminder', 'sender', 'verified sender'],
    steps: [
      'Open CRM > Follow-up Sequences and start from a ready template (new inquiry, viewing follow-up, long-term nurture).',
      'Set what starts it: by hand, a new website enquiry, a viewing booked or a viewing completed. Add steps: emails or tasks with waits.',
      'Verify your company domain and create a sender address under Settings > Email. Only verified senders can send.',
      'Check the first message with a test send to yourself, then switch the sequence on.',
    ],
    limits: ['A sequence stops when the customer replies, books a viewing, opts out, or the lead is won or lost.', 'It waits if there is no verified sender or no email allowance left on your plan.', 'French and Arabic templates are machine-prepared and need a native read before use.'],
    faq: [{ q: 'Why are my sequence emails not sending?', a: 'Check that you have a verified sender, the contact has not opted out, and your plan\'s email allowance is not used up.' }],
    internal: ['Reply detection needs an inbound domain on the server; without it staff use Pause or "Customer replied".'],
  },
  'maps-navigate': {
    title: 'Maps and the Navigate button', since: 'v1.60', module: 'Properties, Visits, Field Coverage', video: 'field-coverage-admin',
    who: 'Everyone who views properties, visits or Field Coverage',
    keywords: ['map', 'maps', 'navigate', 'directions', 'location', 'pin', 'field coverage', 'google maps', 'satellite', 'street'],
    steps: [
      'Field Coverage (My Space > Field Coverage) shows each agent as a marker. It refreshes about every 15 seconds.',
      'On a property, drag the pin when adding or editing it and use the place search to jump to an address.',
      'Press Navigate on a property or visit to open Google Maps (Apple Maps on iPhone and Mac) with directions to the spot.',
    ],
    limits: ['On busy teams only the most recent agents are drawn so phones stay fast.', 'Satellite view is available only where your plan includes it.'],
    faq: [{ q: 'The map shows fewer agents than I have.', a: 'Only the most recently reporting agents are drawn on busy teams. Open the list view for everyone.' }],
    internal: ['Free map is the default. Google, MapTiler (satellite) and LocationIQ are optional keys set on the deployment.'],
  },
};

const tidy = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').map((w) => (w.length > 3 && /[^siu]s$/.test(w) ? w.slice(0, -1) : w)).join(' ');
const STOPW = new Set(['how', 'do', 'does', 'did', 'can', 'the', 'and', 'for', 'what', 'where', 'which', 'with', 'from', 'this', 'that', 'is', 'are', 'was', 'to', 'in', 'on', 'of', 'my', 'me', 'i', 'a', 'an', 'it', 'new', 'tell', 'show', 'explain', 'about', 'use', 'work', 'works', 'doe', 'have', 'has', 'option', 'workspace', 'mean', 'when', 'why', 'which', 'there', 'get', 'can', 'will', 'would', 'should', 'add', 'create', 'edit', 'delete', 'view', 'open', 'send', 'make', 'change', 'save', 'do', 'need', 'want', 'please', 'help']);
const sing = (w) => (w.length > 3 && /[^siu]s$/.test(w) ? w.slice(0, -1) : w);
const toks = (s) => tidy(s).split(' ').filter((w) => w.length >= 2 && !STOPW.has(w) && !STOPW.has(sing(w)));

/**
 * Search guides (and release items) for a question. Returns best matches first.
 * `platform` also searches console-only release items and each guide's internal notes.
 */
export function searchKnowledge(question, { platform = false, log = CHANGELOG } = {}) {
  const qt = toks(question);
  if (!qt.length) return [];
  const releases = platform ? log : tenantChangelog(log);
  const out = [];
  for (const [key, g] of Object.entries(GUIDES)) {
    const hay = tidy([g.title, g.module, ...g.keywords, ...g.faq.map((f) => f.q), ...(platform ? g.internal || [] : [])].join(' '));
    let score = 0, matched = 0;
    for (const w of qt) { if (hay.includes(` ${w} `) || hay.startsWith(`${w} `) || hay.endsWith(` ${w}`)) { score += 2; matched++; } else if (w.length > 4 && hay.includes(w)) { score += 1; } }
    if (tidy(question).includes(tidy(g.title))) { score += 6; matched = qt.length; }
    if (score >= 2) out.push({ type: 'guide', key, score: score * 5, coverage: matched / qt.length, guide: g });
  }
  for (const r of releases) for (const it of r.items) {
    if (it.guide) continue; // covered by its guide
    const hay = tidy(`${r.title} ${it.text} ${it.where || ''}`);
    let score = 0; for (const w of qt) if (w.length > 3 && hay.includes(w)) score += 1;
    if (score >= 2) out.push({ type: 'release', version: r.version, score, title: r.title, item: it });
  }
  // every screen in the menu (generated from the app's own navigation), so Ask can answer for any screen
  const seenPath = new Set();
  for (const sc of SCREENS) {
    if (seenPath.has(sc.path)) continue; seenPath.add(sc.path);
    const about = SCREEN_NOTES[sc.path] || '';
    const hay = tidy(`${sc.label} ${sc.section} ${about}`), label = tidy(sc.label);
    let score = 0, matched = 0; for (const w of qt) { if (` ${label} `.includes(` ${w} `)) { score += 3; matched++; } else if (hay.includes(` ${w} `) || hay.startsWith(`${w} `)) { score += 1; } }
    const named = tidy(question).includes(label) && label.length > 3; if (named) score += 5;
    if (score >= 3) out.push({ type: 'screen', score, named, coverage: matched / qt.length, screen: { ...sc, about } });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Every guide, grouped for the console knowledge base (newest release first). */
export const guideList = () => Object.entries(GUIDES).map(([key, g]) => ({ key, ...g })).sort((a, b) => b.since.localeCompare(a.since, undefined, { numeric: true }));

/** Rank free-form documents ({id,title,keywords,text}) against a question. Titles and keywords weigh more than body text. */
export function searchDocs(question, docs, limit = 3) {
  const qt = [...new Set(toks(question))];
  if (!qt.length) return [];
  const prepared = docs.map((d) => ({ d, t: ` ${tidy(d.title)} `, k: ` ${tidy(d.keywords || '')} `, b: ` ${tidy(d.text)} ` }));
  const N = prepared.length;
  const df = Object.fromEntries(qt.map((w) => [w, prepared.filter((p) => p.t.includes(` ${w} `) || p.k.includes(` ${w} `) || p.b.includes(` ${w} `)).length]));
  const idf = (w) => Math.log(1 + (N - df[w] + 0.5) / (df[w] + 0.5));
  const total = qt.reduce((s, w) => s + idf(w), 0) || 1;
  return prepared.map((p) => {
    let score = 0, hit = 0;
    for (const w of qt) {
      const inT = p.t.includes(` ${w} `), inK = p.k.includes(` ${w} `), inB = p.b.includes(` ${w} `);
      if (!inT && !inK && !inB) continue;
      hit += idf(w);
      score += idf(w) * ((inT ? 3 : 0) + (inK ? 2.5 : 0) + (inB ? 1 : 0));
    }
    return { doc: p.d, score, coverage: hit / total };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
