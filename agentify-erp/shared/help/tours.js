// Guided product tours. One source for: the in-app tour (client/src/components/ProductTour.jsx), the "Take the tour" button, and Ask
// (the matching guide in guides.js repeats each tour in words). A step points at `data-tour="<target>"` in the client code; a step
// whose target is not on screen (hidden by role, plan or screen size) is skipped. Bump `version` to show a tour again to everyone.
// RULE: when a feature of a module changes, update that module's tour steps here and its guide in guides.js in the same change.
// Write for customers in plain words; never mention the console or platform administrators.
export const TOURS = {
  main: {
    title: 'Welcome tour', guide: 'product-tour', version: 1, autostart: true,
    steps: [
      { target: 'search', title: 'Search everything', text: 'Type a name, phone number, property or invoice to jump straight to it.' },
      { target: 'nav', title: 'Your menu', text: 'Everything you are allowed to use is here. Groups such as CRM or Accounting open to show their pages.' },
      { target: 'menu-button', title: 'Open the menu', text: 'On a phone, tap here to open the full menu.' },
      { target: 'mobile-tabs', title: 'Quick tabs', text: 'The bottom bar takes you to the pages you use most.' },
      { target: 'ask', title: 'Ask for help or numbers', text: 'Ask a question in your own words, such as "how many leads this month?" or "how do I add a payment?".' },
      { target: 'notifications', title: 'Notifications', text: 'Reminders, approvals and updates from your team show up here.' },
      { target: 'appearance', title: 'Make it yours', text: 'Switch between light and dark and change how the app looks.' },
      { target: 'take-tour', title: 'See this again any time', text: 'Press this button whenever you want the tour again.' },
    ],
  },
  creative: {
    title: 'Creative Studio tour', guide: 'creative-studio', version: 3, autostart: true, path: '/creative',
    steps: [
      { target: 'creative-credits', title: 'Your credits', text: 'Stories, images and reels spend credits. This line shows what is left this month and what each one costs.' },
      { target: 'creative-tabs', title: 'Five tabs', text: 'Start with Brand profile, then write a Brand story, create Post images or Video reels. Saved work is under My creations.' },
      { target: 'creative-calendar', title: 'Send it to the calendar', text: 'On My creations, Send to calendar adds a picture, video or story to the Content Calendar as a draft, ready for a date and approval.' },
      { target: 'reel-length', title: 'Reel length', text: 'On the Video reels tab choose 8, 16 or 24 seconds. Longer reels cost more credits.' },
      { target: 'reel-voice-path', title: 'Two ways to add a voice', text: 'Exact script puts your own words, read by a voice you can listen to first, inside the finished video. The quick way lets the video itself speak, but the voice and words can vary.' },
      { target: 'take-tour', title: 'See this again', text: 'Press this button to replay the tour for the page you are on.' },
    ],
  },
  content: {
    title: 'Content Calendar tour', guide: 'content-calendar-posting', version: 1, autostart: true, path: '/content',
    steps: [
      { target: 'content-calendar', title: 'Your calendar', text: 'Posts sit on the day they will go out. Drag a post to another day to reschedule it, or switch to the week view for the details.' },
      { target: 'content-connect', title: 'Connect your accounts', text: 'Connect your Facebook Page and Instagram here, so approved posts publish by themselves.' },
      { target: 'content-accounts', title: 'Where it will post', text: 'Choose the connected accounts for this post and set a date and time.' },
      { target: 'content-approval', title: 'Approval first', text: 'A post is sent for approval, and only an approver can approve it. Nothing is published before that, and the post shows who approved it.' },
      { target: 'take-tour', title: 'See this again', text: 'Press this button to replay the tour for the page you are on.' },
    ],
  },
};

export const tourList = () => Object.entries(TOURS).map(([key, t]) => ({ key, ...t }));
/** Plain-text version of a tour, for Ask and for the guide check. */
export const tourText = (key) => (TOURS[key]?.steps || []).map((s, i) => `${i + 1}. ${s.title}: ${s.text}`).join('\n');
