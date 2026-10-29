# Tenant file storage (Contabo Object Storage), v1.50

Private files that workspaces upload are kept in an S3-compatible bucket (Contabo Object Storage), each workspace in its own folder. Public website images stay on the server.

## What goes where
| Where | What |
|---|---|
| Bucket | documents (contacts, tenders, vendor bids), payment slips, content creatives, call and meeting recordings, billing payment proofs |
| Server disk (unchanged) | photos and logos used on the public website, listings and profiles (`/uploads/media/*`), tenant training videos, the databases |

Public images are not put in the bucket so shared pages and search results never get broken, expiring links. They still count toward the workspace's storage quota.

## Settings (environment only, never in git)
`S3_ENDPOINT` (for example `https://usc1.contabostorage.com`), `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`. Path-style addressing is always used. Optional `S3_TOTAL_QUOTA_GB` (default 250; also editable in the console).

Deploys write them to `server/.env` from GitHub Actions secrets with the same names (`deploy.yml`, `remote-bootstrap.sh`). Without all five, the app keeps storing private files on the server exactly as before.

## Keys and the tenant rule
`tenants/{tenant_id}/{module}/{year}/{uuid}-{filename}`. The tenant id always comes from the signed-in workspace, never from a request. `assertKeyBelongsToTenant` runs inside every read, sign and delete in `services/storage.js` and refuses another workspace's prefix, `..`, absolute paths and odd encodings (tests in `server/test/storage.test.js`).

## Database
Each workspace database has `stored_files(file_key, tenant_id, module, size_bytes, mime_type, original_name, storage_provider, created_at)`. The row that uses a file keeps `path = "s3:<file_key>"`; any other value is a legacy file on disk (provider `local`) and keeps working until migrated. No URL is ever stored.

## Private files and links
Routes keep their URLs and permission checks. After the check passes, a browser opening a document, image, video or audio is redirected to a 15-minute signed link; scripted fetches and framed previews are streamed through the app (keeps the content security policy and same-origin fetches working).

## Quota
Storage limit = the plan's storage (Plans & pricing, or Storage & quotas) unless the console set a limit for that workspace. Used = upload folder (public images, legacy files) + private files in the bucket (exact, from `stored_files`). Checked before every upload (request size, then exact file sizes). At 80% one e-mail and an in-app notice; at 100% uploads are refused with an upgrade prompt and one e-mail; flags reset below 75%. A daily job also checks every workspace.

## Console: Plans & Subscriptions > Storage & quotas
Per-workspace used vs limit (public images and private files separately), the storage of every plan (editable), a per-workspace limit (plan / custom GB / unlimited, with a reason), the bucket total against 250 GB, the quota promised to workspaces, and **Sync from bucket**, which lists the real objects per workspace folder and shows any difference from the app's records. Contabo has no per-folder quota, so limits are enforced by the app.

## Moving existing files
`npm run storage:migrate -- --tenant <slug> --dry-run`, then without `--dry-run`. `--all` for every workspace, `--delete-local` to remove each local copy after it is verified. Each file is copied, size-verified and only then switched; rerunning skips what is already moved. Public images are never moved.

## Not covered
Backups of the bucket (Contabo versioning or a second copy is a separate decision). Bucket CORS is not needed (no direct browser uploads).
