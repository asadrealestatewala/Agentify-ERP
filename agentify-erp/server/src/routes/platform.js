// Control-plane API (not tenant-scoped): self-serve signup and the platform operator's tenant administration.
import crypto from 'node:crypto';
import { issueLoginCode } from '../services/oauthFlow.js';
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncH, bad, HttpError } from '../util.js';
import { sendMail, layout } from '../services/mailer.js';
import { requireOperator, onPlatformHost } from '../services/platformAuth.js';
import { need, auditContext } from '../services/platformAccess.js';
import { audit } from '../services/platformConfig.js';
import { planCatalog, PLAN_SETTINGS, PRODUCTS, PLANS } from '../services/plans.js';
import { submitReview, publicReviews, reviewPhoto } from '../services/reviews.js';
import { publicContent, publicLegal, createDemoRequest, createDeletionRequest, marketingContent, termsVersion } from '../services/marketing.js';
import { recordServerEvent, collect } from '../services/analytics.js';
import { publicAnnouncements } from '../services/announcements.js';
import { listAddons } from '../services/commerce.js';
import { issueVerification } from '../services/accessLinks.js';
import { assertEmailAllowed, signupCodeRequired } from '../services/disposableEmail.js';
import { sendCode, checkCode, canEmailCodes, signupProof, signupProofValid, consumeSignupProof } from '../services/emailOtp.js';
import { get, run } from '../db.js';
import adminRoutes from './platformAdmin.js';
import { verifyWebhook } from '../services/mailbox.js';
import { applyProviderEvent } from '../services/tenantEmail.js';
import { handleInbound } from '../services/emailInbound.js';
import { recordWebhook, applyEvent } from '../services/emailLog.js';
import { verifySignature, applyBillingEvent, setSubscription, listSubmissions, approveSubmission, rejectSubmission, tenantByProviderIds } from '../services/billing.js';
import * as stripe from '../services/stripe.js';
import { handlePlatformWebhook, settlePlatformCheckout } from '../services/platformGateways.js';
import { stripeConfig, getSetting } from '../services/platformConfig.js';
import { publicAppConfig } from '../services/appConfig.js';
import { publicMapsConfig } from '../services/maps.js';
import { selectableRegions, listCountries } from '../regions/index.js';
import { GLOBAL_CRM_COPY } from '../regions/marketingCopy.js';
import { mayIssueCertificate } from '../integrations/domains.js';
import { freeSitesOpen } from '../services/freeSites.js';
import { publicSiteUrl } from '../services/siteHost.js';
import { sitesDomain } from '../platform.js';
import { locate, geoConfigured } from '../services/geo.js';
import { handleCallback } from '../services/oauthFlow.js';
import { PROVIDERS, appCreds, authorizeUrl, readState, redirectUri, signState, mainOrigin } from '../services/oauthApps.js';
import { BASE_DOMAIN, platformDb, resolveTenant, withTenant, isMultiTenant, createTenant, assertOwnerEmailFree, validateSlug, listTenants, getTenant, setTenantStatus, RESERVED_SLUGS } from '../platform.js';

const r = Router();
r.use('/admin', adminRoutes);
r.use(auditContext);

const publicView = (t) => ({ id: t.id, slug: t.slug, name: t.name, product: t.product, trial_started_at: t.trial_started_at, trial_note: t.trial_note || null, owner_email: t.owner_email, is_legacy: !!t.is_legacy, billing_provider: t.billing_provider, billing_interval: t.billing_interval, status: t.status, plan: t.plan, subscription_status: t.subscription_status, current_period_end: t.current_period_end, trial_ends_at: t.trial_ends_at, timezone: t.timezone, currency: t.currency, custom_domain: t.custom_domain, created_at: t.created_at });
/** Workspace address. On localhost (development) keep the scheme and port the request came in on, e.g. http://acme.localhost:4000. */
const urlFor = (slug, req) => (!isMultiTenant() ? null : BASE_DOMAIN === 'localhost' && req ? `${req.protocol}://${slug}.${req.get('host')}` : `https://${slug}.${BASE_DOMAIN}`);

const signupLimiter = rateLimit({ windowMs: 60 * 60_000, limit: Number(process.env.SIGNUP_LIMIT) || 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many signups from this address. Try again later.' } });

/** Public: what the marketing page on the main domain shows. `landing` is false on workspace addresses and in single-company installs. */
// remote configuration of the Android app shell (colours, title, update notice). Public and cached briefly; answers on the
// main domain and on every workspace address, and uses the workspace's company name as the title on the latter.
r.get('/app-config', (req, res) => {
  let name = '';
  try { name = resolveTenant(req.hostname)?.name || ''; } catch { /* unknown host: platform name */ }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(publicAppConfig(name));
});

// which map the pages draw: Google Maps when the platform has a browser key, otherwise OpenStreetMap (key is public by design, see services/maps.js)
r.get('/maps-config', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(publicMapsConfig());
});

r.get('/site', (req, res) => {
  const landing = isMultiTenant() && onPlatformHost(req);
  if (!landing) return res.json({ landing: false, multi_tenant: isMultiTenant() });
  const methods = [...new Set(platformDb().prepare('SELECT method FROM payment_accounts WHERE active=1 ORDER BY sort_order, id').all().map((a) => a.method))];
  res.json({ landing: true, regions: [...selectableRegions(platformDb()).values()].map((p) => ({ code: p.code, name: p.name, currency: p.currency, sub_region_label: p.sub_region_label, sub_regions: p.sub_regions, languages: p.languages })), countries: listCountries(platformDb()), crm_global: GLOBAL_CRM_COPY, base_domain: BASE_DOMAIN, free_sites: { open: freeSitesOpen(), domain: freeSitesOpen() ? sitesDomain() : null }, trial_days: PLAN_SETTINGS.default_trial_days, plans: planCatalog(), products: PRODUCTS, addons: listAddons({ activeOnly: true }).map(({ id, name, description, product, price, entitlements }) => ({ id, name, description, product, price, entitlements })), local_methods: methods, cards: stripe.stripeConfigured(), signup_email_code: signupCodeNeeded() });
});

/** Approximate country and city of the visitor, for the marketing headline only (see services/geo.js). Never blocks the page. */
const geoLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } });
r.get('/geo', geoLimiter, asyncH(async (req, res) => {
  const g = await locate(req);
  const supported = !!g.country && listCountries(platformDb()).some((c) => c.code === g.country);
  res.set('Cache-Control', 'private, max-age=3600');
  res.json({ country: g.country, city: g.city || null, supported, source: g.source, configured: geoConfigured() });
}));

/** Is this workspace address free? (never reveals which tenants exist beyond availability) */
r.get('/slug-available/:slug', asyncH((req, res) => {
  try { validateSlug(req.params.slug); res.json({ available: true }); }
  catch (e) { if (e instanceof HttpError) return res.json({ available: false, reason: e.message }); throw e; }
}));

/** Every provider sends the browser back here (the one address registered in their consoles); we forward it to the workspace. */
const oauthDone = asyncH(async (req, res) => {
  const provider = req.params.provider;
  if (!PROVIDERS[provider]) return res.status(404).send('Unknown provider');
  const params = { ...req.query, ...(req.body || {}) };
  const out = await handleCallback(provider, params, req);
  if (out.detail) console.warn(`[oauth ${provider}]`, out.detail);
  if (!out.redirect) return res.status(400).type('text/plain').send(out.error || 'This sign-in could not be completed.');
  res.redirect(303, out.redirect);
});
r.get('/oauth/:provider/callback', oauthDone);
r.post('/oauth/:provider/callback', express.urlencoded({ extended: false, limit: '100kb' }), oauthDone);

/** "Continue with Google" on the signup page. Only the product and country choices travel with the sign-in (no personal data). */
r.get('/oauth/google/signup', asyncH((req, res) => {
  if (!appCreds('google')) throw bad('Google sign-up is not set up on this platform yet.');
  const q = new URLSearchParams();
  for (const k of ['product', 'country']) { const v = String(req.query[k] || ''); if (/^[A-Za-z_]{2,20}$/.test(v)) q.set(k, v); }
  const state = signState({ purpose: 'signup', origin: mainOrigin(req), q: q.toString() });
  res.redirect(303, authorizeUrl('google', 'signup', { state, redirect: redirectUri('google', req) }));
}));
/** What the signup page may show after Google sent the visitor back: the name and email inside the signed token. */
r.get('/google-identity', asyncH((req, res) => {
  const t = readState(req.query.token);
  if (!t || t.purpose !== 'google-signup' || !t.email) throw new HttpError(400, 'This Google sign-in expired. Choose Continue with Google again.');
  res.json({ email: t.email, name: t.name || '' });
}));

/** The web server asks this before it issues an HTTPS certificate for a host name (Caddy on-demand TLS "ask"). */
r.get('/domain-check', (req, res) => res.sendStatus(mayIssueCertificate(req.query.domain) ? 200 : 404));

/** The signup form asks for a code only when the platform can really email one (otherwise there is nothing to type). */
const signupCodeNeeded = () => signupCodeRequired() && canEmailCodes();
const codeLimiter = rateLimit({ windowMs: 60 * 60_000, limit: Number(process.env.SIGNUP_CODE_LIMIT) || 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many codes asked for from this address. Try again later.' } });
/** Step 1 of signup: refuse throw-away addresses, then email a 6-digit code to the one typed. */
r.post('/signup/email-code', codeLimiter, asyncH(async (req, res) => {
  if (!isMultiTenant()) throw new HttpError(404, 'Workspace signup is switched off on this server.');
  const email = String(req.body?.email || '').trim().toLowerCase();
  await assertEmailAllowed(email);
  if (!signupCodeNeeded()) return res.json({ required: false });
  const out = await sendCode({ purpose: 'signup', email, ip: req.ip, heading: 'Confirm your email address', intro: 'Enter this code on the Agentify ERP signup page to confirm your email address.' });
  res.json({ required: true, ...out });
}));
/** Step 2: the right code returns a single-use proof that the signup form sends along with the rest. */
r.post('/signup/verify-code', codeLimiter, asyncH((req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const row = checkCode({ purpose: 'signup', email, code: req.body?.code });
  res.json({ proof: signupProof(email, row.id) });
}));

/** Self-serve signup: creates the workspace (own database + uploads), its base configuration and the first admin. */
r.post('/signup', signupLimiter, asyncH(async (req, res) => {
  if (!isMultiTenant()) throw new HttpError(404, 'Workspace signup is switched off: this server is running in single-company mode. Start it with ERP_BASE_DOMAIN=localhost (run-agentify-erp.bat does this).');
  const b = req.body || {};
  if (b.accept_terms !== true) throw bad('Please accept the Terms of Service and Privacy Policy to create a workspace');
  // With a valid Google token the address is the one Google verified, and the owner signs in with Google (a password can be set later with "Forgot password").
  let google = null;
  if (b.google_token) {
    const t = readState(b.google_token);
    if (!t || t.purpose !== 'google-signup' || !t.email) throw bad('Your Google sign-in expired. Choose Continue with Google again.');
    google = t;
  }
  // not through Google: refuse throw-away addresses and ask for proof that the mailbox is theirs
  if (!google) {
    await assertEmailAllowed(b.admin_email);
    if (signupCodeNeeded() && !signupProofValid(b.email_proof, b.admin_email)) throw bad('Confirm your email address with the code we email you, then try again.');
  }
  const free = b.product === 'website';
  if (free) {
    if (!freeSitesOpen()) throw new HttpError(403, 'Free websites are not open yet.');
    const who = String(google ? google.email : b.admin_email || '').trim().toLowerCase();
    if (who && platformDb().prepare("SELECT 1 FROM tenants WHERE product='website' AND lower(owner_email)=?").get(who)) throw new HttpError(409, 'There is already a free website for this email address. Sign in to it, or use another email.');
  }
  assertOwnerEmailFree(google ? google.email : b.admin_email);
  const tenant = createTenant({
    slug: b.slug, name: b.company_name, adminName: String(b.admin_name || (google && google.name) || '').trim() || 'Admin', adminEmail: google ? google.email : b.admin_email, adminPassword: google ? crypto.randomBytes(24).toString('base64url') : b.admin_password,
    timezone: b.timezone || 'Asia/Karachi', currency: b.currency || 'PKR', region: b.region || 'PK', sub_region: b.sub_region || null, language: b.language || null, demo: !free && b.sample_data === true && String(b.region || 'PK').toUpperCase() !== 'PK', product: free ? 'website' : b.product || 'real_estate', trialPolicy: !free,
  });
  if (!google && signupCodeNeeded()) consumeSignupProof(b.email_proof);
  // which version of the Terms the owner accepted (0 = the unpublished template) and when
  platformDb().prepare('UPDATE tenants SET terms_version=?, terms_accepted_at=? WHERE id=?').run(termsVersion(), new Date().toISOString(), tenant.id);
  const url = urlFor(tenant.slug, req);
  const origin = url || `${req.protocol}://${req.get('host')}`;
  // the owner confirms the address with the link in the welcome email; until then they cannot invite others (stops the form being used to mail strangers)
  let ownerId = null;
  const proved = !!google || signupCodeNeeded(); // Google, or the emailed code, already proved the mailbox
  const token = withTenant(tenant, () => {
    const owner = get('SELECT id FROM users WHERE lower(email)=lower(?)', tenant.owner_email);
    ownerId = owner.id;
    // a code confirmed at signup already proved the mailbox; the welcome email then needs no confirm step
    run('UPDATE users SET email_verified=?, contact_id=NULL WHERE id=?', proved ? 1 : 0, owner.id);
    return proved ? null : issueVerification(owner.id);
  });
  const siteUrl = publicSiteUrl(tenant, req);
  const mail = layout({ brand: 'platform', heading: free ? `Your free website ${tenant.name} is ready to build` : `Your ${tenant.name} workspace is ready`, lines: [free ? `Your website will be public at ${siteUrl} once you publish it. Publishing needs a confirmed email address.` : '', google ? `You signed up with Google as ${tenant.owner_email}, so there is nothing to confirm. Sign in with Google any time, or use Forgot password to set a password.` : proved ? `${tenant.owner_email} is confirmed. Sign in to start setting up your company.` : `Confirm ${tenant.owner_email} with the button below, then sign in to start setting up your company.`, tenant.trial_ends_at ? `Your ${PLAN_SETTINGS.default_trial_days}-day free trial runs until ${tenant.trial_ends_at.slice(0, 10)} (UTC).` : tenant.trial_note ? `${tenant.trial_note}. Choose a plan in Settings > Plan & Billing to start.` : ''].filter(Boolean), button: proved ? { label: 'Open your workspace', url: origin } : { label: 'Confirm email and open workspace', url: `${origin}/verify-email/${token}` } });
  await sendMail({ type: 'welcome', to: tenant.owner_email, subject: `Welcome: ${tenant.name} is ready`, ...mail });
  recordServerEvent('signup_completed', { ...(b.analytics || {}), product: tenant.product, tenant_id: tenant.id });
  // the browser is sent into the new workspace already signed in (one-time code, valid two minutes), not to its sign-in page
  const enter = url && ownerId ? `${url}/login?sso=${issueLoginCode(tenant.id, ownerId, 'signup')}` : null;
  res.status(201).json({ tenant: publicView(tenant), email_confirmed: proved, login_url: url, enter_url: enter, site_url: free ? siteUrl : undefined });
}));

r.get('/tenants', requireOperator, need('workspaces.view'), (_req, res) => res.json(listTenants().map(publicView)));
r.post('/tenants/:id/status', requireOperator, need('workspaces.suspend'), asyncH((req, res) => {
  const t = getTenant(Number(req.params.id));
  if (!t) throw new HttpError(404, 'Tenant not found');
  if (t.is_legacy && req.body?.status !== 'active') throw bad('The original workspace cannot be suspended from here');
  const out = setTenantStatus(t.id, req.body?.status);
  audit(req.operator.email, `workspace-${out.status}`, { slug: out.slug, reason: req.body?.reason || null });
  res.json(publicView(out));
}));
/**
 * Payment-provider webhook (normalised JSON, see services/billing.js), signed with BILLING_WEBHOOK_SECRET.
 * Not tenant-scoped: the event names its tenant. Provider adapters translate their own payloads into this shape.
 */
/** Stripe: its own signature scheme; events we do not act on, or that name no known workspace, are acknowledged so Stripe stops retrying. */
/** Resend webhooks (Svix-signed): delivery events update the sent log; a received e-mail is noted so the inbox can show it was seen. Idempotent by event id. */
r.post('/webhooks/resend', asyncH(async (req, res) => {
  const secret = getSetting('resend_webhook_secret');
  if (!secret) throw new HttpError(503, 'The Resend signing secret is not saved yet');
  if (!verifyWebhook(req.rawBody, req.headers, secret)) throw new HttpError(401, 'Invalid signature');
  const ev = req.body || {}, type = String(ev.type || '').slice(0, 60), id = req.headers['svix-id'];
  if (!recordWebhook(id, 'resend', type, /received/.test(type) ? { from: String(ev.data?.from || '').slice(0, 200), subject: String(ev.data?.subject || '').slice(0, 200) } : null)) return res.json({ ok: true, duplicate: true });
  if (ev.data?.email_id && type.startsWith('email.') && !/received/.test(type)) {
    applyEvent(ev.data.email_id, type, ev.created_at || new Date().toISOString());
    // tenant mail: the workspace is found from our own record of the provider message id, never from the request
    applyProviderEvent(ev.data.email_id, type, ev.created_at || new Date().toISOString(), { bounce_type: ev.data?.bounce?.type || ev.data?.bounce_type });
  }
  if (/received/.test(type) && ev.data?.email_id) await handleInbound(ev.data.email_id, ev.data);
  res.json({ ok: true });
}));
/** Plan-payment gateways (PayPal, Tap, ...): the call-back only prompts a check with the provider; nothing activates on its word. */
r.post('/pay/webhook/:provider', asyncH(async (req, res) => res.sendStatus(await handlePlatformWebhook(req.params.provider, req))));
r.get('/pay/return/:provider/:token', asyncH(async (req, res) => {
  const token = String(req.params.token).replace(/[^a-f0-9]/g, '');
  try { await settlePlatformCheckout(token); } catch { /* the billing page keeps showing "confirming"; the webhook retries */ }
  res.redirect(`/settings/billing?gw=${token}`);
}));
r.post('/billing/webhook/stripe', asyncH((req, res) => {
  if (!stripe.verifyWebhook(req.rawBody, req.headers['stripe-signature'])) throw new HttpError(401, 'Invalid signature');
  // an event from the other mode (e.g. a test event while live is active) must not change real subscriptions
  if (typeof req.body?.livemode === 'boolean' && req.body.livemode !== (stripeConfig().mode === 'live')) return res.json({ ok: true, ignored: true });
  const ev = stripe.mapEvent(req.body, tenantByProviderIds);
  if (!ev || !ev.tenant_id) return res.json({ ok: true, ignored: true });
  try { res.json({ ok: true, applied: applyBillingEvent('stripe', ev).applied }); }
  catch (e) { if (e instanceof HttpError && e.status === 404) return res.json({ ok: true, ignored: true }); throw e; }
}));
r.post('/billing/webhook/:provider', asyncH((req, res) => {
  if (!verifySignature(req.rawBody, req.headers['x-signature'])) throw new HttpError(401, 'Invalid signature');
  const out = applyBillingEvent(req.params.provider, req.body);
  res.json({ ok: true, applied: out.applied });
}));
/** Manual billing for operators: record a bank transfer / invoice payment by setting the plan directly. */
r.post('/tenants/:id/subscription', requireOperator, need('billing.manage'), asyncH((req, res) => {
  res.json(publicView(setSubscription(Number(req.params.id), req.body || {}, { actor: req.operator.email, reason: req.body?.reason })));
}));
/** Local-method payments waiting for the operator to confirm the money arrived. */
r.get('/payments', requireOperator, need('billing.view'), (req, res) => res.json(listSubmissions(req.query.status)));
r.post('/payments/:id/approve', requireOperator, need('billing.manage'), asyncH(async (req, res) => {
  const t = await approveSubmission(Number(req.params.id), req.body?.note, req.operator.email);
  audit(req.operator.email, 'payment-approved', { slug: t.slug, payment: Number(req.params.id) });
  res.json(publicView(t));
}));
r.post('/payments/:id/reject', requireOperator, need('billing.manage'), asyncH(async (req, res) => {
  await rejectSubmission(Number(req.params.id), req.body?.note);
  audit(req.operator.email, 'payment-rejected', { payment: Number(req.params.id), reason: req.body?.note });
  res.json({ ok: true });
}));
r.get('/reserved', (_req, res) => res.json([...RESERVED_SLUGS]));

// ---- Public marketing website (main domain only)
const publicLimiter = rateLimit({ windowMs: 60 * 60_000, limit: Number(process.env.PUBLIC_FORM_LIMIT) || 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests from this address. Try again later.' } });
const mainOnly = (req) => { if (!isMultiTenant() || !onPlatformHost(req)) throw new HttpError(404, 'Not found'); };
/** Everything the marketing pages show: editable content, plans by product, add-ons, trial terms and payment options. */
r.get('/marketing', asyncH((req, res) => {
  mainOnly(req);
  const methods = [...new Set(platformDb().prepare('SELECT method FROM payment_accounts WHERE active=1 ORDER BY sort_order, id').all().map((a) => a.method))];
  const regions = [...selectableRegions(platformDb()).values()].map((p) => ({ code: p.code, name: p.name, currency: p.currency, sub_region_label: p.sub_region_label, sub_regions: p.sub_regions, languages: p.languages }));
  res.json({ content: { ...publicContent(), reviews: publicReviews() }, base_domain: BASE_DOMAIN, free_sites: { open: freeSitesOpen(), domain: freeSitesOpen() ? sitesDomain() : null }, regions, countries: listCountries(platformDb()), crm_global: GLOBAL_CRM_COPY, trial_days: PLAN_SETTINGS.default_trial_days, one_trial_per_email: PLAN_SETTINGS.one_trial_per_email, products: PRODUCTS,
    plans: planCatalog().filter((p) => PLANS[p.id]?.visible), addons: listAddons({ activeOnly: true }).map(({ id, name, description, product, price, entitlements }) => ({ id, name, description, product, price, entitlements })),
    google_signup: !!appCreds('google'), local_methods: methods, cards: stripe.stripeConfigured(), signup_email_code: signupCodeNeeded(), terms_version: termsVersion(), ga4_id: getSetting('ga4_measurement_id') || null });
}));
r.get('/announcements', asyncH((req, res) => { mainOnly(req); res.json(publicAnnouncements()); }));
r.get('/legal/:slug', asyncH((req, res) => { mainOnly(req); res.json(publicLegal(req.params.slug)); }));
/** Public account-deletion request (required by app stores). A hidden field catches bots; the answer never says whether the account exists. */
r.post('/deletion-request', publicLimiter, asyncH(async (req, res) => {
  mainOnly(req);
  const b = req.body || {};
  if (b.website) return res.status(201).json({ ok: true });
  const out = createDeletionRequest(b);
  const to = process.env.SALES_EMAIL || process.env.BILLING_OPERATOR_EMAIL || marketingContent().contact_email;
  if (to) await sendMail({ type: 'deletion_request', to, subject: `Account deletion request: ${out.email}`, ...layout({ brand: 'platform', heading: 'Account deletion request', lines: [`From: ${out.email}`, `Workspace: ${out.workspace || '—'}`, out.note || ''].filter(Boolean) }) }).catch(() => {});
  res.status(201).json({ ok: true });
}));
/** Contact / demo request form. A hidden "website" field catches bots; nothing is sent to the visitor. */
r.post('/demo-request', publicLimiter, asyncH(async (req, res) => {
  mainOnly(req);
  const b = req.body || {};
  if (b.website) return res.status(201).json({ ok: true }); // honeypot: pretend success
  const out = createDemoRequest(b);
  const to = process.env.SALES_EMAIL || process.env.BILLING_OPERATOR_EMAIL || marketingContent().contact_email;
  if (to) await sendMail({ type: 'demo_request', to, subject: `Demo request: ${out.name}`, ...layout({ brand: 'platform', heading: 'New demo request', lines: [`${out.name} <${out.email}>`, `Company: ${b.company || '—'} · Product: ${out.product || 'not chosen'} · Team: ${b.team_size || '—'}`, String(b.message || '').slice(0, 1000)] }) });
  recordServerEvent('demo_requested', { product: out.product, source: b.source, landing_page: b.landing_page, visitor_id: b.visitor_id, session_id: b.session_id, consent: b.consent });
  res.status(201).json({ ok: true });
}));
/** Customer review from the website: kept as pending until a console user approves it. Photos are served from here, only for approved reviews. */
r.post('/reviews', publicLimiter, asyncH((req, res) => {
  mainOnly(req);
  const b = req.body || {};
  if (b.website) return res.status(201).json({ ok: true }); // honeypot
  submitReview(b);
  res.status(201).json({ ok: true });
}));
r.get('/reviews/:id/photo', asyncH((req, res) => {
  mainOnly(req);
  const p = reviewPhoto(req.params.id);
  res.set({ 'Content-Type': p.type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).send(p.buffer);
}));
/** First-party website analytics (consent required; Do Not Track / GPC honoured). */
const analyticsLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many events' } });
r.post('/analytics/collect', analyticsLimiter, asyncH((req, res) => {
  mainOnly(req);
  res.json(collect(req, req.body || {}, BASE_DOMAIN));
}));
/** "Which workspaces are mine?": emails the owner the addresses; the answer is the same whether or not any exist. */
r.post('/find-workspace', publicLimiter, asyncH(async (req, res) => {
  mainOnly(req);
  const e = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('Please enter a valid email address');
  const list = listTenants().filter((t) => !t.is_legacy && t.owner_email === e && t.status !== 'cancelled');
  if (list.length) await sendMail({ type: 'workspace_list', to: e, subject: 'Your Agentify ERP workspaces', ...layout({ brand: 'platform', heading: 'Your workspaces', lines: list.map((t) => `${t.name}: ${urlFor(t.slug, req)}/login`) }) });
  res.json({ ok: true, message: 'If that email owns a workspace, we have emailed its address.' });
}));
r.use((_req, _res, next) => next(new HttpError(404, 'Endpoint not found')));

export default r;
