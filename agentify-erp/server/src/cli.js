// Server-side maintenance commands (run on the server, never exposed over HTTP):
//   npm run platform:setup-token   print a fresh one-time token for /platform/first-run (only while no console account exists)
//   npm run platform:set-owner     create a Platform Owner, or reset that account's password (and turn its two-factor off); reads the email and
//                                  the password from the first two lines of standard input, so the password never appears in a command line
//   npm run platform:lifecycle     run the subscription lifecycle job once (trial expiry, reminders, renewals)
//   npm run storage:migrate -- --tenant <slug>|--all [--dry-run] [--delete-local]   move a workspace's private files from the VPS disk to the bucket
import { platformDb } from './platform.js';
import { issueSetupToken, setupNeeded, SETUP_TOKEN_FILE } from './services/platformStaff.js';

const cmd = process.argv[2];
platformDb();
if (cmd === 'setup-token') {
  if (!setupNeeded()) { console.error('The platform already has a console account. Sign in at /platform, or ask a Platform Owner to invite you.'); process.exit(1); }
  const token = issueSetupToken();
  console.log(`One-time setup token (valid 24 hours, also saved to ${SETUP_TOKEN_FILE}):\n\n  ${token}\n\nOpen https://<your main domain>/platform/first-run and enter it to create the Platform Owner.`);
} else if (cmd === 'set-owner') {
  const { default: bcrypt } = await import('bcryptjs');
  const input = await new Promise((resolve) => { let s = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (d) => { s += d; }); process.stdin.on('end', () => resolve(s)); });
  const [email, password] = input.split('\n').map((x) => x.replace(/\r$/, ''));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) { console.error('The first line must be a valid email address.'); process.exit(1); }
  if (!password || password.length < 10) { console.error('The second line must be a password of at least 10 characters.'); process.exit(1); }
  const db = platformDb();
  const hash = bcrypt.hashSync(password, 10);
  const row = db.prepare('SELECT id FROM platform_admins WHERE email=?').get(email.trim());
  if (row) {
    db.prepare('UPDATE platform_admins SET password_hash=?, token_version=token_version+1, totp_enabled=0, totp_secret=NULL, recovery_codes=NULL WHERE id=?').run(hash, row.id);
    db.prepare("INSERT INTO platform_audit(admin, action, detail) VALUES(?,?,?)").run('server', 'owner-password-reset', email.trim().toLowerCase());
    console.log(`Password reset for ${email.trim().toLowerCase()}. Every earlier session was signed out and two-factor sign-in was turned off for this account.`);
  } else {
    db.prepare("INSERT INTO platform_admins(email,name,password_hash,role,activated_at) VALUES(?,?,?,'platform_owner',datetime('now'))").run(email.trim().toLowerCase(), 'Platform owner', hash);
    db.prepare("INSERT INTO platform_audit(admin, action, detail) VALUES(?,?,?)").run('server', 'owner-created', email.trim().toLowerCase());
    console.log(`Platform Owner created: ${email.trim().toLowerCase()}`);
  }
} else if (cmd === 'lifecycle') {
  const { runLifecycle } = await import('./services/lifecycle.js');
  console.log(JSON.stringify(await runLifecycle(), null, 2));
} else if (cmd === 'storage-migrate') {
  const args = process.argv.slice(3);
  const flag = (n) => args.includes(n);
  const tenant = args[args.indexOf('--tenant') + 1];
  if (!flag('--all') && (!flag('--tenant') || !tenant)) { console.error('Usage: storage-migrate --tenant <slug> | --all  [--dry-run] [--delete-local]'); process.exit(1); }
  const { migrateTenant, migrateAll } = await import('./services/storageMigrate.js');
  const opts = { dryRun: flag('--dry-run'), deleteLocal: flag('--delete-local'), log: console.log };
  const res = flag('--all') ? await migrateAll(opts) : [await migrateTenant(tenant, opts)];
  for (const r of res) console.log(`${r.slug}: ${r.files} file(s), ${(r.bytes / 1048576).toFixed(1)} MB${opts.dryRun ? ' would move' : `, moved ${r.moved}`}${r.skipped ? `, ${r.skipped} already in the bucket` : ''}${r.missing.length ? `, ${r.missing.length} missing on disk` : ''}${r.failed.length ? `, ${r.failed.length} FAILED` : ''}`);
  for (const r of res) for (const f of r.failed) console.error(`  failed ${r.slug} ${f.file}: ${f.error}`);
  if (res.some((r) => r.failed.length)) process.exit(2);
} else if (cmd === 'storage-sync') {
  const { syncBucket, overview } = await import('./services/storageAlerts.js');
  const r = await syncBucket('server');
  console.log(JSON.stringify(r));
  const o = await overview();
  for (const t of o.tenants) if (t.bucket_files) console.log(`${t.slug}: ${t.bucket_files} file(s), ${t.bucket_bytes} bytes in the bucket`);
  console.log(`bucket total: ${o.bucket.used_bytes} bytes of ${o.bucket.total_gb} GB`);
} else {
  console.error('Usage: node src/cli.js setup-token | set-owner | lifecycle | storage-migrate | storage-sync');
  process.exit(1);
}
