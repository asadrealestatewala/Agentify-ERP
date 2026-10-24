# Phase 2 setup and rollback

**Setup.** Merging to `main` deploys. Database tables are created automatically on start (new tables only; no existing table is changed). Staff with the Website permission then see Settings > Website Integrations. Nothing is switched on until someone creates a connection.

**Rollback (code).** Revert the Phase 2 merge commit on `main`; the deploy workflow redeploys and has its own health check and automatic rollback. The new tables stay in the databases unused and harmless; no data migration is needed. Existing `/api/public` endpoints and the company website keep working throughout (they now share the same lead code as the API).

**Switch off without a rollback.** Disconnect a connection in the screen (its key stops working at once), or remove its forms.

**Housekeeping.** Webhook delivery history is kept 30 days, idempotency records 24 hours.
