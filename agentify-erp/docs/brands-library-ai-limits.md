# Brand groups, shared template library and workspace AI limits (v1.51)

Source: the "Agentify ERP — New Feature Requirements" doc. What shipped, and what did not.

## Brand groups (console: Workspaces > Brands)
* `brands` table in the platform database; `tenants.brand_id` (null = independent workspace, as before).
* Shared: logo and primary colour only. Applied by writing the workspace's own `brand_logo` / `brand_color` settings (logo copied into the workspace's own `media/` folder), so receipts, emails and the app need no new lookups. Saving a brand re-applies it to every member.
* Locked in the workspace: the Branding page disables colour/logo changes the brand sets (`GET /api/settings/brand-group`; the server refuses changes too). Removing a workspace or deleting the brand frees it; it keeps the last applied look.
* A brand has one optional "main" workspace and a read-only roll-up (counts only; no shared billing, staff or data access).
* Accent colour is stored with the brand but nothing in the app uses it yet. Typography accents, and brochure/listing templates inherited from the main workspace, are not built (the shared library covers shared wording).

## Shared template library (console: System > Template library; workspace: Documents > Shared library)
* `library_items` (contract template, clause, brochure layout, email template; versioned; retire/reinstate) and `workspace_library_overrides` (platform database).
* A workspace sees active items read-only and can "Use my own version" (only it sees that) or go back to the shared one. Editing the shared text bumps its version; overriding workspaces see "Shared text updated". The console lists who overrode what and whether they are behind.
* Items are plain text kept for reading and copying. They are not wired into document generation (the region document templates under Documents are unchanged). Per-brand libraries are out of scope, as in the doc.
* New permission `library.manage` (Platform Owner, Super Admin, Platform Administrator).

## Workspace AI limits (console: Reports & Analytics > AI usage & credits)
* Metering already existed (`ai_usage`: tokens per call, purpose, workspace). This adds `workspace_ai_settings` (on/off, daily call limit per workspace) and platform settings: kill switch, default daily limit, monthly cap on estimated workspace AI spend (needs the provider prices already entered there), per-feature switches.
* Enforced by `setUsageGate` in `integrations/ai.js`, before the data assistant, property writer, website builder and promo video features call a model. A blocked feature returns a plain-words 400.
* A "call" is one recorded model request, so one assistant question can be several calls. Speech-to-text transcription is not metered or gated yet.
* Not built: the flagged/reported AI output queue (the product has no "report this answer" action). Agentify's own Gemini post drafts keep their separate budget.
