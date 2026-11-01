# Content calendar auto-posting

Agentify's own marketing posts (Console > Marketing > Content calendar) can be published by the server instead of by hand.

## Safety rules
- Off by default. A Super Admin switches it on (platform-wide) and connects accounts.
- A person approves each post ("Approve auto-post" on a scheduled post). The approval is for that exact text, media, channel and time. Editing it, rescheduling, unscheduling or canceling withdraws the approval.
- A post whose title or notes say `DO NOT POST` or `ON HOLD` (for example the seller-partner video until written consent) can never be approved or auto-posted, even if the text is edited afterwards.
- A failure stops auto-posting for that post, keeps it scheduled and shows the channel's own message. It is never retried automatically, so a post cannot go out twice. A post whose time was missed by more than 6 hours is not posted late. After a restart in the middle of a publish the post is flagged as "not known whether it went out".
- Posts that auto-post are recorded as posted (`posted_by = auto-post`) and count toward the posting limits like any other.

## Connecting accounts
Console > Integrations: save the Meta (Facebook and Instagram), LinkedIn and TikTok app keys (redirect `https://<main domain>/api/platform/oauth/<provider>/callback`). Then Content calendar > Auto-posting > Connect. Tokens are stored encrypted in the platform database. Each provider reviews the app before it may post for a real account; until then the post fails with their message. TikTok posts are sent as private drafts (SELF_ONLY) until the app is audited.

## What can be posted
| Channel | Text | Image | Video |
| --- | --- | --- | --- |
| Facebook Page | yes (with link) | yes | yes (file URL) |
| Instagram | no | yes | yes (Reel, waits for processing) |
| LinkedIn | yes | link card only | not supported |
| TikTok | no | no | yes |
X, YouTube, WhatsApp and the rest stay manual (Mark as posted). The media address must be public (promo videos are served from `/promo-media/`).

## Tests
`server/test/content-autopost.test.js`.
