import assert from 'node:assert/strict';
import { join } from 'node:path';

/** Local records only. Provider-facing submissions are intercepted and fail. */
export async function auditExtendedWorkflows({ page, device, ids, base, out, check }) {
  await check(`/admin/accounts/${ids.org}`, 'member-controls-layout-failure-and-transfer-cancel', async () => {
    await page.getByRole('tab', { name: /^People \(/ }).click();
    const role = page.getByLabel('Role for ui-member@example.test', { exact: true });
    const email = page.getByText('ui-member@example.test', { exact: true });
    const a = await email.boundingBox(); const b = await role.boundingBox();
    assert(a && b && (a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y), 'Member identity and role controls must not overlap');
    const endpoint = `**/api/admin/accounts/${ids.org}`;
    await page.route(endpoint, r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The role could not be changed.' }) }));
    try {
      await role.selectOption('viewer');
      await page.getByRole('alert').filter({ hasText: 'The role could not be changed.' }).waitFor();
      assert.equal(await role.inputValue(), 'member');
      await page.screenshot({ path: join(out, `${device}-member-role-recovery.png`) });
    } finally { await page.unroute(endpoint); }
    await page.locator('li').filter({ has: role }).getByRole('button', { name: 'Make owner', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Hand this account to ui-member@example.test', exact: true });
    await dialog.waitFor();
    assert(await dialog.getByRole('button', { name: 'Cancel', exact: true }).evaluate(el => document.activeElement === el));
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await role.inputValue(), 'member');
  });
  await check('/admin/billing', 'billing-pagination-search-details-and-back', async () => {
    const cards = page.locator('[data-billing-account]').filter({ visible: true });
    assert.equal(await cards.count(), 20, 'Billing loads a manageable page of accounts');
    await page.getByRole('navigation', { name: 'Billing pages', exact: true }).getByRole('link', { name: 'Next page', exact: true }).click();
    await page.waitForURL('**/admin/billing?page=2');
    await cards.first().waitFor();
    assert.equal(await cards.count(), 20);
    await page.goBack({ waitUntil: 'networkidle' });
    await page.getByLabel('Find an account', { exact: true }).fill('Interface Audit Workspace');
    await page.getByLabel('Subscription status', { exact: true }).selectOption('active');
    await page.getByRole('button', { name: 'Search billing', exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('q') === 'Interface Audit Workspace');
    await cards.first().waitFor();
    assert.equal(await cards.count(), 1);
    if (device !== 'desktop') {
      await cards.getByText('Billing details', { exact: true }).click();
      await cards.getByText('Discount', { exact: true }).waitFor();
      await cards.getByText('Next attempt', { exact: true }).waitFor();
    }
    await page.screenshot({ path: join(out, `${device}-billing-filtered.png`) });
    await cards.getByRole('link', { name: 'Interface Audit Workspace', exact: true }).click();
    await page.waitForURL(`**/admin/accounts/${ids.org}`);
    await page.goBack({ waitUntil: 'networkidle' });
    assert.equal(await page.getByLabel('Find an account', { exact: true }).inputValue(), 'Interface Audit Workspace');
    assert.equal(await cards.count(), 1);
  });
  await check('/communications', 'draft-status-and-delivery-evidence', async () => {
    await page.getByText('Draft, not sent', { exact: true }).waitFor();
    if (device === 'desktop') {
      assert.equal(await page.getByText('100%', { exact: true }).count(), 0, 'An unsent draft must not imply confirmed delivery');
      await page.getByText('Nothing sent yet', { exact: true }).first().waitFor();
    }
  });
  await check('/call-queue', 'call-workspace-load-failure-and-recovery', async () => {
    const endpoint = `**/api/call-cards/${ids.call}/workspace`;
    await page.route(endpoint, r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The call could not be loaded.' }) }));
    try {
      await page.goto(`${base}/call-queue?open=${ids.call}`, { waitUntil: 'networkidle' });
      await page.getByRole('alert').filter({ hasText: 'The call workspace did not load' }).waitFor();
    } finally { await page.unroute(endpoint); }
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    const workspace = page.getByRole('region', { name: 'Call workspace for Sample Electrical Services', exact: true });
    await workspace.waitFor();
    await page.screenshot({ path: join(out, `${device}-call-workspace-recovery.png`) });
    await workspace.getByRole('button', { name: 'Close', exact: true }).click();
    await workspace.waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: 'Calls', exact: true }).waitFor();
    // No dialing, scope acknowledgement, call outcome or follow-up is submitted.
  });
  for (const route of ['/pipeline', '/pipeline?view=list', '/pipeline?view=stages', '/pipeline?view=table', '/subs', '/communications', '/today', '/workbench', '/call-queue', '/search?q=Facility', '/recap']) {
    const viewName = route.slice(1).replace(/[?=]/g, '-');
    await check(route, `${viewName}-quick-view-and-history`, async () => {
      if (route === '/today') {
        await page.locator('[data-today-details] > summary').click();
      }
      if (route === '/pipeline?view=stages' && device !== 'desktop') {
        await page.getByRole('tablist', { name: 'Pipeline stages', exact: true }).getByRole('tab', { name: /^Scoring/ }).click();
      }
      if (route === '/recap') {
        const todayHref = await page.getByRole('link', { name: 'Today so far', exact: true }).getAttribute('href');
        assert(todayHref);
        await page.goto(base + todayHref, { waitUntil: 'networkidle' });
      }
      await page.getByRole('link', { name: 'Quick look', exact: true }).filter({ visible: true }).first().click();
      const drawer = page.getByRole(device === 'desktop' ? 'complementary' : 'dialog', { name: 'Record details', exact: true });
      await drawer.waitFor();
      await page.waitForFunction(() => {
        const rect = document.querySelector('[aria-label="Record details"]')?.getBoundingClientRect();
        return rect && rect.height > 100 && rect.top >= 0 && rect.bottom <= innerHeight + 2;
      });
      await page.screenshot({ path: join(out, `${device}-${viewName}-quick-view.png`) });
      await drawer.getByRole('link', { name: 'Close details', exact: true }).click();
      await drawer.waitFor({ state: 'hidden' });
      await page.goBack({ waitUntil: 'networkidle' });
      await drawer.waitFor();
      await page.goForward({ waitUntil: 'networkidle' });
      await drawer.waitFor({ state: 'hidden' });
    });
  }
  await check('/settings/account', 'personal-name-timezone-and-recovery', async () => {
    const name = page.getByLabel('Your name', { exact: true });
    const form = page.locator('form').filter({ has: name });
    await name.fill(`Audit owner ${device}`);
    await page.route('**/api/account/name', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Your name could not be saved.' }) }));
    try {
      await form.getByRole('button', { name: 'Save', exact: true }).click();
      await form.getByRole('alert').waitFor();
      assert.equal(await name.inputValue(), `Audit owner ${device}`);
    } finally { await page.unroute('**/api/account/name'); }
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await form.getByRole('status').filter({ hasText: 'Saved.' }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await name.inputValue(), `Audit owner ${device}`);
    const zone = page.getByLabel('Your time zone', { exact: true });
    await zone.selectOption('America/New_York');
    const zoneGroup = page.locator('div').filter({ has: zone }).filter({ has: page.getByRole('button', { name: 'Save', exact: true }) });
    await zoneGroup.last().getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Saved.' }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await zone.inputValue(), 'America/New_York');
  });

  await check('/subs', 'contact-edit-focus-failure-save', async () => {
    const trigger = page.getByRole('button', { name: 'Edit contact info for Sample Electrical Services', exact: true }).filter({ visible: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Edit contact: Sample Electrical Services', exact: true });
    assert(await dialog.evaluate(el => el.matches(':modal')));
    const email = dialog.getByLabel('Email', { exact: true });
    assert(await email.evaluate(el => document.activeElement === el));
    await email.fill(`electrical-${device}@example.test`);
    await dialog.getByLabel('Phone', { exact: true }).fill('2085550100');
    if (device !== 'desktop') {
      // Exercise the viewport event path; this is not a physical keyboard test.
      await page.evaluate(() => {
        Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => 320 });
        visualViewport.dispatchEvent(new Event('resize'));
      });
      try {
        await page.waitForFunction(() => document.querySelector('[data-keyboard-open="true"]'));
        const field = await dialog.getByLabel('Phone', { exact: true }).boundingBox();
        assert(field && field.y >= 0 && field.y + field.height <= 320, 'Focused field stays above the simulated keyboard');
        const save = dialog.getByRole('button', { name: 'Save', exact: true });
        await save.scrollIntoViewIfNeeded();
        const bounds = await save.boundingBox();
        assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 320, 'Save can be reached above the simulated keyboard');
        await page.screenshot({ path: join(out, `${device}-contact-keyboard-viewport.png`) });
      } finally {
        await page.evaluate(() => {
          delete visualViewport.height;
          visualViewport.dispatchEvent(new Event('resize'));
        });
      }
      await page.waitForFunction(() => !document.querySelector('[data-keyboard-open="true"]'));
    }
    await page.route(`**/api/subs/${ids.sub}`, r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Contact changes were not saved.' }) }));
    try {
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await dialog.getByRole('alert').waitFor();
      assert.equal(await email.inputValue(), `electrical-${device}@example.test`);
      await page.screenshot({ path: join(out, `${device}-contact-edit-recovery.png`) });
    } finally { await page.unroute(`**/api/subs/${ids.sub}`); }
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.reload({ waitUntil: 'networkidle' });
    await trigger.click();
    assert.equal(await email.inputValue(), `electrical-${device}@example.test`);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert(await trigger.evaluate(el => document.activeElement === el));
  });

  await check(`/contracts/${ids.contract}`, 'contract-milestone-issue-and-coordination', async () => {
    const milestones = page.locator('#milestones');
    await milestones.getByRole('button', { name: 'Add one', exact: true }).click();
    await milestones.getByLabel('What is it', { exact: true }).fill(`Electrical inspection ${device}`);
    await milestones.getByLabel('Due', { exact: true }).fill('2027-01-10');
    await milestones.getByRole('button', { name: 'Add', exact: true }).click();
    await milestones.getByRole('button', { name: 'Mark delivered', exact: true }).waitFor();
    await milestones.getByRole('button', { name: 'Mark delivered', exact: true }).click();
    await milestones.getByRole('button', { name: 'Mark outstanding', exact: true }).waitFor();
    await milestones.getByRole('button', { name: 'Mark outstanding', exact: true }).click();
    await milestones.getByRole('button', { name: 'Mark delivered', exact: true }).waitFor();
    const issues = page.locator('#issues');
    await issues.getByRole('button', { name: 'Raise one', exact: true }).click();
    await issues.getByLabel('What happened', { exact: true }).fill(`Access gate locked ${device}`);
    await issues.getByRole('button', { name: 'Raise', exact: true }).click();
    await issues.getByRole('button', { name: 'Resolve it', exact: true }).click();
    await issues.getByLabel(/^How was it resolved/).fill('Agency supplied a temporary access code.');
    await issues.getByRole('button', { name: 'Resolve', exact: true }).click();
    await issues.getByText('Resolved: Agency supplied a temporary access code.', { exact: true }).waitFor();
    const contacts = page.locator('#coordination');
    await contacts.getByRole('button', { name: 'Log a contact', exact: true }).click();
    await contacts.getByLabel('Who with', { exact: true }).fill('Audit project manager');
    await contacts.getByLabel('What was discussed', { exact: true }).fill('Confirmed inspection access and timing.');
    await contacts.getByRole('button', { name: 'Log it', exact: true }).click();
    await contacts.getByText('Confirmed inspection access and timing.', { exact: true }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    await milestones.getByRole('button', { name: 'Mark delivered', exact: true }).waitFor();
    await issues.getByText('Resolved: Agency supplied a temporary access code.', { exact: true }).waitFor();
  });

  await check('/settings/rules', 'rules-tabs-preview-save-and-reload', async () => {
    await page.getByText('Adjust automation rules', { exact: true }).click();
    const amber = page.getByLabel(/^Turn amber this many days before the deadline/);
    const value = String(Number(await amber.inputValue()) + 1);
    await amber.fill(value);
    const tabs = page.getByRole('tablist', { name: 'Automation rule sections', exact: true });
    await tabs.getByRole('tab', { name: 'Calls', exact: true }).click();
    await tabs.getByRole('tab', { name: 'Deadlines', exact: true }).click();
    assert.equal(await amber.inputValue(), value);
    const saved = page.waitForResponse(r => r.url() === base + '/api/automation/rules' && r.request().method() === 'POST' && !r.request().postDataJSON().preview_only);
    await page.getByRole('button', { name: 'Save rules', exact: true }).filter({ visible: true }).click();
    assert((await saved).ok());
    await page.getByText(/^Saved at .*Applied everywhere immediately\./).filter({ visible: true }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    if (!(await amber.isVisible())) await page.getByText('Adjust automation rules', { exact: true }).click();
    assert.equal(await amber.inputValue(), value);
  });

  await check('/settings/recap', 'recap-schedule-save-and-preview', async () => {
    const time = page.getByLabel(/^Send at/);
    await time.fill('07:15');
    const response = page.waitForResponse(r => r.url() === base + '/api/recap/settings' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save settings', exact: true }).filter({ visible: true }).click();
    assert((await response).ok());
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await time.inputValue(), '07:15');
    await page.getByRole('button', { name: 'Show preview', exact: true }).click();
    await page.getByRole('button', { name: 'Hide preview', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Hide preview', exact: true }).click();
    // No test message is sent and workers are not running.
  });

  await check('/analytics', 'custom-metric-create-delete-recovery', async () => {
    await page.getByRole('button', { name: '+ Add KPI', exact: true }).first().click();
    const label = `Audit metric ${device}`;
    await page.getByLabel('Name (optional)', { exact: true }).fill(label);
    await page.getByRole('button', { name: 'Add KPI', exact: true }).click();
    await page.getByText(label, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Remove KPI', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove this KPI?', exact: true });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByText(label, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Remove KPI', exact: true }).click();
    await page.route('**/api/kpis/*', r => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    try {
      await dialog.getByRole('button', { name: 'Remove it', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: 'The KPI could not be removed.' }).waitFor();
    } finally { await page.unroute('**/api/kpis/*'); }
    await dialog.getByRole('button', { name: 'Remove it', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByText(label, { exact: true }).waitFor({ state: 'hidden' });
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.getByText(label, { exact: true }).count(), 0);
  });

  await check('/admin/invitations', 'invitation-offer-preview-and-failure', async () => {
    await page.getByLabel('Email address', { exact: true }).fill('invitation-audit@example.test');
    await page.getByRole('combobox').filter({ has: page.getByRole('option', { name: 'A percentage off', exact: true }) }).selectOption('percent');
    await page.getByLabel('Percentage off', { exact: true }).fill('25');
    await page.getByRole('complementary', { name: 'Offer preview', exact: true }).waitFor();
    await page.route('**/api/admin/invitations', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The invitation was not created.' }) }));
    try {
      await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'The invitation was not created.' }).waitFor();
      assert.equal(await page.getByLabel('Email address', { exact: true }).inputValue(), 'invitation-audit@example.test');
    } finally { await page.unroute('**/api/admin/invitations'); }
  });
}
