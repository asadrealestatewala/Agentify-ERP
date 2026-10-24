// Platform presets: what a customer on a hosted website builder does to show an Agentify enquiry form, and what to watch for.
// These are written from each builder's documented embed features and have NOT been tested on live accounts; the screen says so.
// The form itself is the same for every builder (see routes/embed.js); a preset only chooses the snippet and the steps.
export const PRESETS = {
  webflow: {
    label: 'Webflow',
    snippet: 'script',
    summary: 'Use an Embed element and paste the one-line script.',
    steps: [
      'In the Webflow Designer, drag an Embed element (Add > Components > Embed) to where the form should appear.',
      'Paste the script snippet below into it and save.',
      'Publish the site. The form shows on the published page, not in the Designer canvas.',
    ],
    allow: ['Your live domain, for example https://www.yourcompany.com', 'The Webflow preview address, for example https://yoursite.webflow.io'],
    cautions: ['Custom code needs a Webflow site plan that allows it; check your plan.'],
  },
  wix: {
    label: 'Wix',
    snippet: 'iframe',
    summary: 'Use an Embed element that shows a web address, with the form address.',
    steps: [
      'In the Wix editor choose Add > Embed Code > Embed a Site and place it where the form should appear.',
      'Choose Enter Website Address and paste only the address from the iframe snippet below (the part inside src="...").',
      'Resize the element tall enough for the form, then publish the site.',
    ],
    allow: ['Your live domain, for example https://www.yourcompany.com', 'The Wix address of the site, for example https://yourname.wixsite.com'],
    cautions: [
      'Wix places "HTML" embed code inside its own frame, which this form refuses to appear in. Use "Embed a Site" with the address, not the script.',
      'A Wix embed cannot resize itself, so give it enough height.',
    ],
  },
  squarespace: {
    label: 'Squarespace',
    snippet: 'script',
    summary: 'Use a Code block and paste the one-line script.',
    steps: [
      'Edit the page, add a Code block where the form should appear, and make sure "Display Source" is off.',
      'Paste the script snippet below and save.',
      'The form shows on the live page, not always in the editor preview.',
    ],
    allow: ['Your live domain, for example https://www.yourcompany.com', 'The Squarespace address of the site, for example https://yourname.squarespace.com'],
    cautions: ['Code blocks need a Squarespace plan that supports custom code; check your plan.'],
  },
};
export const presetFor = (platform) => PRESETS[platform] || null;
