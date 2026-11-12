import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegion } from '../../shared/region/index.js';

test('country terms rewrite generic labels; Pakistan is unchanged', () => {
  const uk = buildRegion({ region: 'UK', terminology: { customer: 'Client', buyer: 'Purchaser', seller: 'Vendor' } });
  assert.equal(uk.localize('All Customers'), 'All Clients');
  assert.equal(uk.localize('Buyers'), 'Purchasers');
  assert.equal(uk.localize('Add a customer'), 'Add a client');
  assert.equal(uk.localize('Sales & Bookings'), 'Sales & Bookings');
  const us = buildRegion({ region: 'US', terminology: { sales_agent: 'Agent' } });
  assert.equal(us.localize('Top Sales Agents'), 'Top Agents');
  const pk = buildRegion({});
  assert.equal(pk.localize('All Customers'), 'All Customers');
});
