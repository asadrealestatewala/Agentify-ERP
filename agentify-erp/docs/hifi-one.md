# Hifi One connection

Hifi One (Hifi Marketing's partner and reseller ERP) reads one status line per workspace so its partners and sales
agents can see which of their clients are live. Nothing else leaves Agentify.

## Set up (no server settings)

1. Console → Integrations → **Hifi One** → **Make a key** (needs `integrations.manage`). Copy the address and key; the key is shown once.
2. In Hifi One: Partner Stack → Live Solutions → **Connect** → Agentify ERP, paste the address and key.
3. Hifi One reads every 15 minutes. The card shows "Connected" after the first read.

**Make a new key** stops the old key at once. **Remove key** stops all reads. Both are in the platform audit trail.

## Contract

`GET https://<platform domain>/api/hifi-one/summary[?next=<cursor>]` with `Authorization: Bearer agt_hifi_…`.
Platform domain only (404 on workspace hosts), 60 requests a minute, 500 workspaces per page.

```json
{ "reportedAt": "ISO", "next": null,
  "workspaces": [{ "id": "slug", "name": "Acme Homes", "status": "TRIAL|LIVE|OVERDUE|SUSPENDED|CANCELLED",
    "plan": "growth", "paidUntil": "YYYY-MM-DD", "activeUsers": 4, "lastActivityAt": "ISO" }] }
```

Status from `billingState`: trialing/pending → TRIAL, active → LIVE, past_due → OVERDUE, suspended/expired → SUSPENDED,
canceled → CANCELLED. `paidUntil` is the trial end date during a trial, otherwise the period end. `activeUsers` counts
active staff (not portal users, not demo users). The original (legacy) workspace and erased workspaces are left out.

Code: `server/src/services/hifiOne.js`, `server/src/routes/hifiOne.js`, test `server/test/hifi-one.test.js`.
