// The product version, injected from client/package.json at build time (vite.config.js). It equals the first entry of
// shared/changelog.js (server/test/changelog.test.js enforces that). Importing changelog.js here would pull the whole
// changelog into every page load, so keep this file free of it.
export const APP_VERSION = `v${__APP_VERSION__.replace(/\.0$/, '')}`;
