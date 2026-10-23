import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { uploadDir, get } from './db.js';
import { scheduleBackups } from './services/backup.js';
import { tenantContext, bootstrapTenants, forEachTenant, forEachTenantAsync, isMultiTenant, resolveTenant, BASE_DOMAIN } from './platform.js';
import { runDuePosts } from './integrations/social.js';
import { injectMeta, platformSitemap, platformRobots, MARKETING_ROUTES } from './services/marketing.js';
import { ensureFirstAdmin } from './services/platformAuth.js';
import { markJob, snapshot, generateNotifications } from './services/platformMetrics.js';
import { maintenanceGate, recordError } from './services/maintenance.js';
import { runLifecycle } from './services/lifecycle.js';
import platformRoutes from './routes/platform.js';
import billing from './routes/billing.js';
import { billingGuard, apiAccessGuard } from './services/plans.js';
import { authenticate, csrfGuard, requireStaff } from './rbac.js';
import { HttpError } from './util.js';
import { runReminders } from './services/reminders.js';
import { runGoalReminders } from './services/goals.js';
import goals, { push } from './routes/goals.js';
import assistant from './routes/assistant.js';
import site from './routes/site.js';
import siteAdmin from './routes/siteAdmin.js';
import staff from './routes/staff.js';
import insights from './routes/insights.js';
import tenders from './routes/tenders.js';
import listings from './routes/listings.js';
import seo, { robots, sitemap } from './routes/seo.js';
import claims, { feed as paymentFeed } from './routes/claims.js';
import vendorPortal from './routes/vendorPortal.js';
import content, { contentReminders } from './routes/content.js';
import promos from './routes/promos.js';
import announcements from './routes/announcements.js';
import training from './routes/training.js';
import construction from './routes/construction.js';
import regionRoutes from './routes/region.js';
import mortgageRoutes from './regions/mortgage.js';
import documentRoutes from './regions/documents.js';
import privacyRoutes from './regions/privacy.js';
import integrationRoutes from './routes/integrations.js';
import appointmentRoutes from './routes/appointments.js';
import meetingRoutes, { roomRouter as meetingRoom, runMeetingReminders } from './routes/meetings.js';
import integrationHooks from './integrations/hooks.js';
import { sendAlert } from './services/integrations.js';

import auth from './routes/auth.js';
import settings from './routes/settings.js';
import crm from './routes/crm.js';
import agents from './routes/agents.js';
import properties from './routes/properties.js';
import projects from './routes/projects.js';
import sales from './routes/sales.js';
import accounting from './routes/accounting.js';
import hrm from './routes/hrm.js';
import reports from './routes/reports.js';
import dashboard from './routes/dashboard.js';
import misc from './routes/misc.js';
import portal from './routes/portal.js';
import pub from './routes/public.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  console.log('[boot] createApp: bootstrapping tenants');
  bootstrapTenants();
  ensureFirstAdmin();
  console.log('[boot] createApp: tenants ready, wiring routes');
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:', 'https:'], mediaSrc: ["'self'", 'blob:', 'https:'], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], // Google Analytics 4 is loaded only after a visitor consents and only when the platform owner configured it
    scriptSrc: ["'self'", "'wasm-unsafe-eval'", 'https://www.googletagmanager.com'], frameSrc: ["'self'", 'https://www.youtube.com', 'https://www.google.com', 'https://www.openstreetmap.org'], connectSrc: ["'self'", ...(BASE_DOMAIN ? [`https://*.${BASE_DOMAIN}`, `http://*.${BASE_DOMAIN}:*`] : []),'https://www.google-analytics.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com'], workerSrc: ["'self'", 'blob:'], manifestSrc: ["'self'"],
    // Only force https in production; on plain http://localhost it can break service-worker and asset fetches.
    upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null } }, hsts: process.env.NODE_ENV === 'production', crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // gzip text responses (the app script alone is 2.3 MB raw); live streams are left alone so they are not buffered
  app.use(compression({ filter: (req, res) => !/event-stream/.test(String(res.getHeader('Content-Type') || '')) && compression.filter(req, res) }));
  // the billing webhook is signed over the exact bytes, so keep them for that one route
  app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { if (req.originalUrl.startsWith('/api/platform/billing/webhook') || req.originalUrl.startsWith('/api/platform/webhooks/')) req.rawBody = buf; } }));
  app.use(cookieParser());

  // Platform (control plane) API: signup, tenant admin. Never tenant-scoped.
  app.use('/api/platform', platformRoutes);

  // Everything below runs inside the tenant that owns the request's host name. Placed after the body parsers so the
  // tenant context is not lost in stream callbacks.
  // maintenance mode closes every workspace; the platform console (mounted above) keeps working
  app.use('/api', maintenanceGate);
  // the main (marketing) domain has its own sitemap and robots rules; workspaces keep theirs
  const onMain = (req) => isMultiTenant() && !resolveTenant(req.hostname);
  app.get('/sitemap.xml', (req, res, next) => (onMain(req) ? res.type('application/xml').send(platformSitemap(req)) : next()));
  app.get('/robots.txt', (req, res, next) => (onMain(req) ? res.type('text/plain').send(platformRobots(req)) : next()));
  app.use(tenantContext);

  // Public website API: key-authenticated, CORS-open (no cookies involved)
  app.use('/api/public', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  }, apiAccessGuard, pub);

  // provider call-backs (signed by the provider; no sign-in)
  app.use('/api/hooks', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }), integrationHooks);

  // the meeting room: guests join with a link and no account, so it sits before sign-in
  app.use('/api/meet', meetingRoom);

  app.use('/api', rateLimit({ windowMs: 60_000, limit: 900, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } }));
  app.use('/api', authenticate, csrfGuard);
  app.use('/api', billingGuard);

  // Listing media (images/videos) is public by design; documents are NOT served statically.
  app.use('/uploads/media', (req, res, next) => {
    if (!req.tenant) return next();
    express.static(path.join(uploadDir(), 'media'), { maxAge: '7d', setHeaders: (r) => r.setHeader('X-Content-Type-Options', 'nosniff') })(req, res, next);
  });
  // direct links to /uploads/<path> where path already contains the "media/" folder
  app.get('/health', (_req, res) => res.json({ ok: true, db: !!get('SELECT 1 v') }));

  app.use('/api/auth', auth);
  app.use('/api/billing', billing);
  app.use('/api/site', site);
  app.use('/api/site-admin', siteAdmin);
  app.use('/api/goals', goals);
  app.use('/api/staff', staff);
  app.use('/api/insights', insights);
  app.use('/api/tenders', tenders);
  app.use('/api/listings', listings);
  app.use('/api/seo', seo);
  app.use('/api/payment-claims', claims);
  app.use('/api/payment-feed', paymentFeed);
  app.use('/api/vendor', vendorPortal);
  app.use('/api/content', content);
  app.use('/api/promos', promos);
  app.use('/api/announcements', announcements);
  app.use('/api/training', training);
  app.use('/api/construction', construction);
  app.use('/api/region', regionRoutes);
  app.use('/api/mortgage', mortgageRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/privacy', privacyRoutes);
  app.use('/api/integrations', integrationRoutes);
  app.use('/api/appointments', appointmentRoutes);
  app.use('/api/meetings', meetingRoutes);
  app.use('/api/push', push);
  app.use('/api/assistant', assistant);
  app.use('/api/portal', portal);
  app.use('/api/settings', settings);
  app.use('/api/agents', agents);
  app.use('/api/dashboard', dashboard);
  app.use('/api/reports', reports);
  app.use('/api/properties', properties);
  app.use('/api/hrm', hrm);
  app.use('/api', crm);
  app.use('/api', projects);
  app.use('/api', sales);
  app.use('/api/accounting', accounting);
  app.use('/api', misc);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endpoint not found')));

  app.get('/sitemap.xml', sitemap);
  app.get('/robots.txt', robots);

  // Serve the built SPA when present
  const dist = path.join(here, '..', '..', 'client', 'dist');
  if (fs.existsSync(dist)) {
    // built files have a content hash in their name, so browsers may keep them for good; the page itself is always re-checked
    app.use('/assets', express.static(path.join(dist, 'assets'), { maxAge: '365d', immutable: true }));
    app.use(express.static(dist));
    // marketing pages on the main domain get their title, description, canonical and sharing tags on the server (crawlers)
    let shell = null;
    app.get(/^\/(?!api|uploads).*/, (req, res) => {
      if (onMain(req) && MARKETING_ROUTES[req.path]) {
        shell ||= fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
        return res.type('html').send(injectMeta(shell, req.path, req));
      }
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is too large' });
    if (err.name === 'MulterError') return res.status(400).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (/UNIQUE constraint failed/.test(err.message || '')) return res.status(409).json({ error: 'A record with this unique value already exists' });
    console.error(err);
    recordError(err, req);
    sendAlert(`Server error on ${req.method} ${req.path}: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  });
  console.log('[boot] createApp: routes ready');
  return app;
}

// pm2 never passes this file as argv[1] - it launches its own ProcessContainerFork.js wrapper and names
// the real entry in pm_exec_path - so an argv-only check is false under pm2, the module loads, and the
// process then idles forever without ever binding a port. Accept either name, compared by real path.
const thisFile = fileURLToPath(import.meta.url);
const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
const entries = [process.argv[1], process.env.pm_exec_path].filter(Boolean);
const entryFile = entries.find((e) => real(path.resolve(e)) === real(thisFile)) || '';
const isMain = !!entryFile;
console.log(`[boot] entry=${entryFile || '<none>'} argv1=${process.argv[1] || '<none>'} pm_exec_path=${process.env.pm_exec_path || '<none>'} isMain=${isMain}`);

if (isMain) {
  const port = Number(process.env.PORT) || 4000;
  createApp().listen(port, () => console.log(`Expert ERP API listening on http://localhost:${port}`));
  const tick = () => { try { forEachTenant(() => { runReminders(); runGoalReminders(); contentReminders(); }); markJob('tenant-jobs'); } catch (e) { markJob('tenant-jobs', e); } };
  tick();
  scheduleBackups();
  setInterval(tick, 30 * 60 * 1000).unref(); // goal nudges are once-per-day via dedupe keys
  // scheduled social posts go out within a minute of their time
  const socialTick = () => forEachTenantAsync(() => runDuePosts()).then(() => markJob('social-posts')).catch((e) => markJob('social-posts', e));
  setInterval(socialTick, 60 * 1000).unref();
  const meetingTick = () => forEachTenantAsync(() => runMeetingReminders()).then(() => markJob('meeting-reminders')).catch((e) => markJob('meeting-reminders', e));
  setInterval(meetingTick, 60 * 1000).unref();
  // platform-wide: daily metric snapshot (for period comparisons) and super-admin alerts
  const platformTick = () => { try { snapshot(); generateNotifications(null, true); markJob('platform-jobs'); } catch (e) { console.error('[platform jobs]', e); markJob('platform-jobs', e); }
    // trial expiry, reminders and renewals (idempotent; safe to run as often as you like)
    runLifecycle().then((r) => markJob('lifecycle', r.errors.length ? new Error(`${r.errors.length} workspace(s) failed`) : null)).catch((e) => { console.error('[lifecycle]', e); markJob('lifecycle', e); sendAlert(`Lifecycle job failed: ${e.message}`); }); };
  setTimeout(platformTick, 5000).unref();
  setInterval(platformTick, 60 * 60 * 1000).unref();
}
