import assert from 'node:assert/strict';
import { auditExtendedWorkflows } from './extended-workflows.mjs';
import { join } from 'node:path';

/** Tests against disposable records only. No worker or provider credentials. */
export async function auditWorkflows({ page, device, ids, base, out, results, failures, checkpoint }) {
  const check = async (route, task, run) => {
    const record = { device, role: 'owner', route, task, status: 'not verified' };
    try {
      await page.goto(base + route, { waitUntil: 'networkidle' });
      await run();
      record.screenshot = `${device}-workflow-${task}.png`;
      await page.screenshot({ path: join(out, record.screenshot) });
      record.status = 'workflow passed in disposable environment';
      results.push(record);
    } catch (error) {
      record.status = 'workflow failed'; record.finalUrl = page.url(); record.error = String(error.stack ?? error);
      record.screenshot = `${device}-workflow-${task}-failed.png`;
      await page.screenshot({ path: join(out, record.screenshot) }).catch(() => {});
      failures.push(record);
    }
    checkpoint();
  };
  if (device === 'desktop') await check('/agents', 'latest-navigation-replaces-stalled-link', async () => {
    let releaseToday, releaseWorkbench;
    const todayGate = new Promise(resolve => { releaseToday = resolve; });
    const workbenchGate = new Promise(resolve => { releaseWorkbench = resolve; });
    const destinations = url => ['/today', '/workbench'].includes(url.pathname);
    await page.route(destinations, async route => {
      if (route.request().headers().rsc === '1') {
        await (new URL(route.request().url()).pathname === '/today' ? todayGate : workbenchGate);
      }
      await route.continue().catch(() => {}); // Superseded requests may be cancelled.
    });
    try {
      const nav = page.getByRole('navigation', { name: 'Main', exact: true });
      const today = nav.getByRole('link', { name: /^Today/ });
      const workbench = nav.getByRole('link', { name: /^My Work/ });
      await today.click();
      await today.getByRole('status').waitFor();
      await workbench.click();
      await workbench.getByRole('status').waitFor();
      await today.getByRole('status').waitFor({ state: 'hidden' });
      releaseWorkbench();
      await page.waitForURL(url => url.pathname === '/workbench', { timeout: 15000 });
      releaseToday();
      await workbench.getByRole('status').waitFor({ state: 'hidden' });
      await page.waitForLoadState('networkidle');
      assert.equal(new URL(page.url()).pathname, '/workbench', 'The latest destination wins after the old request resolves');
    } finally {
      releaseToday(); releaseWorkbench();
      await page.unroute(destinations);
    }
  });
  await check('/activity', 'activity-history-and-details', async () => {
    const search = page.getByRole('textbox', { name: 'Search messages, subjects, recipients or opportunities' });
    await search.fill('Ledger Audit Draft');
    const heading = page.getByRole('heading', { name: 'Email draft: Ledger Audit Draft', exact: true }).first();
    await heading.waitFor();
    await page.getByText('More filters', { exact: true }).click();
    await page.getByRole('combobox', { name: /^Status/ }).selectOption('failed');
    await page.getByRole('heading', { name: 'No matching activity', exact: true }).waitFor();
    await page.goBack({ waitUntil: 'networkidle' });
    await heading.waitFor();
    assert.equal(await search.inputValue(), 'Ledger Audit Draft');
    assert.equal(await page.getByRole('combobox', { name: /^Status/ }).inputValue(), '');
    await heading.click();
    await page.getByText('Synthetic wording for the ledger regression.', { exact: true }).first().waitFor();
    await page.goForward({ waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'No matching activity', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await heading.waitFor();
  });
  await check('/activity', 'activity-storage-and-network-recovery', async () => {
    await page.getByText('Export or save this view', { exact: true }).click();
    await page.getByLabel('Name this view', { exact: true }).fill('Audit saved view');
    // A denied browser storage operation must not break the ledger.
    await page.evaluate(() => { window.auditOriginalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new DOMException('Storage unavailable', 'SecurityError'); }; });
    try {
      await page.getByRole('button', { name: 'Save view on this device', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'This browser could not save your view' }).waitFor();
      assert.equal(await page.getByLabel('Name this view', { exact: true }).inputValue(), 'Audit saved view');
    } finally {
      await page.evaluate(() => { Storage.prototype.setItem = window.auditOriginalSetItem; delete window.auditOriginalSetItem; });
    }
    await page.getByRole('button', { name: 'Save view on this device', exact: true }).click();
    await page.getByText('Saved views', { exact: true }).click();
    await page.getByRole('button', { name: 'Audit saved view', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Remove saved view Audit saved view', exact: true }).click();
    await page.route('**/api/activity?**', r => r.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }));
    try {
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Your activity could not be loaded' }).waitFor();
    } finally { await page.unroute('**/api/activity?**'); }
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByRole('heading', { name: 'Email draft: Ledger Audit Draft', exact: true }).first().waitFor();
  });
  await check(`/opportunity/${ids.opportunity}`, 'pursuit-pause-network-recovery-and-resume', async () => {
    await page.getByText('Pursuit controls', { exact: true }).click();
    const endpoint = `**/api/opportunities/${ids.opportunity}/pursuit`;
    await page.route(endpoint, r => r.abort('failed'));
    try {
      await page.getByRole('button', { name: 'Pause this pursuit', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'The change was not confirmed.' }).waitFor();
      assert(await page.getByRole('button', { name: 'Pause this pursuit', exact: true }).isEnabled());
    } finally { await page.unroute(endpoint); }
    await page.getByRole('button', { name: 'Pause this pursuit', exact: true }).click();
    await page.getByRole('button', { name: 'Resume', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.getByRole('button', { name: 'Pause this pursuit', exact: true }).waitFor();
  });
  await check('/review', 'nested-confirmation-and-keyboard', async () => {
    await page.getByRole('link', { name: 'Quick look', exact: true }).first().click();
    const drawer = page.getByRole(device === 'desktop' ? 'complementary' : 'dialog', { name: 'Record details', exact: true });
    await drawer.waitFor();
    await drawer.getByRole('button', { name: /^More actions/ }).click();
    await drawer.getByRole('menuitem', { name: /^Pass on it/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Pass on this opportunity', exact: true });
    await dialog.waitFor();
    assert(await dialog.evaluate(el => el.matches(':modal')), 'Confirmation must enter the native top layer');
    const reason = dialog.getByRole('textbox', { name: 'Reason', exact: true });
    assert(await reason.evaluate(el => document.activeElement === el), 'Reason prompt focuses its field');
    const confirm = dialog.getByRole('button', { name: 'Pass on this opportunity', exact: true });
    assert(!(await confirm.isEnabled()), 'Empty reason cannot submit');
    await reason.fill('We are already at capacity.');
    assert(await confirm.isEnabled());
    await dialog.screenshot({ path: join(out, `${device}-nested-confirmation.png`) });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await drawer.waitFor();
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden' });
    await page.goBack({ waitUntil: 'networkidle' });
    await drawer.waitFor();
    await page.goForward({ waitUntil: 'networkidle' });
    await drawer.waitFor({ state: 'hidden' });
  });
  await check(`/subs/${ids.sub}`, 'subcontractor-tabs-notes-and-recovery', async () => {
    const tablist = page.getByRole('tablist');
    await tablist.getByRole('tab', { name: 'Overview', exact: true }).press('End');
    assert.equal(await tablist.getByRole('tab', { name: 'Activity', exact: true }).getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Home');
    assert.equal(await tablist.getByRole('tab', { name: 'Overview', exact: true }).getAttribute('aria-selected'), 'true');
    await tablist.getByRole('tab', { name: 'Notes', exact: true }).click();
    const notes = page.getByRole('textbox', { name: 'Subcontractor notes', exact: true });
    const value = `Follow up about electrical capacity (${device}).`;
    await notes.fill(value);
    await tablist.getByRole('tab', { name: 'Overview', exact: true }).click();
    await tablist.getByRole('tab', { name: 'Notes', exact: true }).click();
    assert.equal(await notes.inputValue(), value, 'Switching tabs preserves drafts');
    await page.route(`**/api/subs/${ids.sub}/notes`, r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Notes could not be saved.' }) }));
    try {
      await page.getByRole('button', { name: 'Save notes', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Notes could not be saved.' }).waitFor();
      assert.equal(await notes.inputValue(), value);
    } finally { await page.unroute(`**/api/subs/${ids.sub}/notes`); }
    await page.getByRole('button', { name: 'Save notes', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    await tablist.getByRole('tab', { name: 'Notes', exact: true }).click();
    assert.equal(await notes.inputValue(), value, 'Saved notes survive reload');
  });
  await check('/compliance', 'compliance-create-failure-retry', async () => {
    await page.getByRole('button', { name: '+ Add your own item', exact: true }).click();
    await page.getByRole('button', { name: 'Add item', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Give it a name.' }).waitFor();
    const name = `Audit insurance renewal ${device}`;
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Category', { exact: true }).selectOption('insurance');
    await page.getByLabel('Renewal / due date (optional)', { exact: true }).fill('2027-01-15');
    await page.route('**/api/compliance', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The item could not be saved.' }) }));
    try {
      await page.getByRole('button', { name: 'Add item', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'The item could not be saved.' }).waitFor();
      assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), name);
    } finally { await page.unroute('**/api/compliance'); }
    const response = page.waitForResponse(r => r.url() === base + '/api/compliance' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Add item', exact: true }).click();
    const created = await response;
    assert(created.ok(), `Save failed (${created.status()}): ${await created.text()}`);
    const savedItem = page.getByText(new RegExp(`^${name}\\s*yours$`));
    await savedItem.waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    await savedItem.waitFor();
    const guide = page.getByText('How compliance checks work', { exact: true });
    const statusGuide = page.getByText('Status guide', { exact: true });
    assert.equal(await guide.evaluate(el => el.parentElement.open), false);
    await guide.click();
    await statusGuide.press('Enter');
    assert.equal(await guide.evaluate(el => el.parentElement.open), true);
    assert.equal(await statusGuide.evaluate(el => el.parentElement.open), true);
    await page.screenshot({ path: join(out, `${device}-compliance-guides-open.png`) });
    await guide.click();
    await statusGuide.press('Enter');
    const card = page.locator('.card').filter({ has: savedItem }).last();
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.locator('.card').filter({ has: page.getByLabel('Notes', { exact: true }) });
    const schedule = editor.getByText('Renewal schedule and escalation', { exact: true });
    assert.equal(await schedule.evaluate(el => el.parentElement.open), false);
    await schedule.click();
    await editor.getByLabel('Warn this many days ahead', { exact: true }).fill('45');
    await schedule.click();
    const note = `Keep the renewal receipt ${device}.`;
    await editor.getByLabel('Notes', { exact: true }).fill(note);
    const endpoint = '**/api/compliance/*';
    await page.route(endpoint, r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The changes could not be saved.' }) }));
    try {
      await editor.getByRole('button', { name: 'Save', exact: true }).click();
      await editor.getByRole('alert').filter({ hasText: 'The changes could not be saved.' }).waitFor();
      assert.equal(await editor.getByLabel('Notes', { exact: true }).inputValue(), note);
      await editor.screenshot({ path: join(out, `${device}-compliance-editor-recovery.png`) });
    } finally { await page.unroute(endpoint); }
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    const savedNote = page.locator('p').filter({ hasText: note });
    await savedNote.waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    await savedNote.waitFor();
    await card.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Delete "${name}"?`, exact: true });
    await dialog.waitFor();
    await page.route(endpoint, r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The item could not be deleted.' }) }));
    try {
      await dialog.getByRole('button', { name: 'Delete it', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: 'The item could not be deleted.' }).waitFor();
      assert(await dialog.isVisible());
      await dialog.screenshot({ path: join(out, `${device}-compliance-delete-recovery.png`) });
    } finally { await page.unroute(endpoint); }
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await savedItem.waitFor();
  });
  await check('/contracts', 'contract-create-failure-retry', async () => {
    await page.getByRole('button', { name: 'Record one by hand', exact: true }).click();
    const number = `AUDIT-MANUAL-${device}`;
    await page.getByLabel('Contract number', { exact: true }).fill(number);
    await page.getByLabel('Award amount', { exact: true }).fill('32000');
    await page.getByLabel('Starts', { exact: true }).fill('2026-10-01');
    await page.getByLabel('Ends', { exact: true }).fill('2027-01-31');
    const contractDialog = page.getByRole('dialog', { name: 'Record a contract', exact: true });
    assert(await contractDialog.evaluate(el => el.matches(':modal')));
    const originalViewport = page.viewportSize();
    await page.setViewportSize(device === 'desktop' ? { width: 1024, height: 600 } : { width: 640, height: 360 });
    try {
      const action = contractDialog.getByRole('button', { name: 'Record it', exact: true });
      await action.scrollIntoViewIfNeeded();
      const bounds = await action.boundingBox();
      assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= page.viewportSize().height, 'Contract action remains reachable on short screens');
      await page.screenshot({ path: join(out, `${device}-contract-short-screen.png`) });
      await contractDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Record one by hand', exact: true }).click();
      assert.equal(await page.getByLabel('Contract number', { exact: true }).inputValue(), number, 'Closing and reopening preserves the draft');
    } finally { await page.setViewportSize(originalViewport); }

    await page.route('**/api/contracts', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The contract could not be saved.' }) }));
    try {
      await page.getByRole('button', { name: 'Record it', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'The contract could not be saved.' }).waitFor();
      assert.equal(await page.getByLabel('Contract number', { exact: true }).inputValue(), number);
    } finally { await page.unroute('**/api/contracts'); }
    await page.getByRole('button', { name: 'Record it', exact: true }).click();
    await page.getByRole('heading', { name: number, exact: true }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: number, exact: true }).waitFor();
  });
  await check(`/vendor/${ids.vendorToken}`, 'vendor-paperwork-forms-and-cancel', async () => {
    await page.getByRole('heading', { name: /Sample Electrical Services, we need/ }).waitFor();
    await page.getByRole('button', { name: 'Fill in and sign', exact: true }).click();
    await page.getByLabel('Mailing address', { exact: true }).waitFor();
    await page.screenshot({ path: join(out, `${device}-vendor-form-open.png`), fullPage: true });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Fill in and sign', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Upload certificate', exact: true }).first().click();
    assert.equal(await page.locator('input[type=file]').count(), 1);
    await page.screenshot({ path: join(out, `${device}-vendor-upload-open.png`), fullPage: true });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.locator('input[type=file]').count(), 0);
    // Form display only. No certification, signature, upload or message.
  });
  await check('/today', 'global-search-keyboard-and-recovery', async () => {
    await page.getByRole('button', { name: 'Search everything', exact: true }).filter({ visible: true }).first().click();
    const dialog = page.getByRole('dialog', { name: /Search/ });
    await dialog.waitFor();
    const input = dialog.getByRole('combobox');
    await page.route('**/api/search?**', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Search unavailable' }) }));
    try {
      await input.fill('Facility maintenance');
      await dialog.getByRole('alert').filter({ hasText: 'Search did not load' }).waitFor();
      assert.equal(await input.inputValue(), 'Facility maintenance');
    } finally { await page.unroute('**/api/search?**'); }
    await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
    const option = dialog.getByRole('option').filter({ hasText: 'Facility maintenance and electrical upgrades' }).first();
    await option.waitFor();
    await input.press('ArrowDown');
    await input.press('ArrowUp');
    await input.press('Enter');
    await page.getByRole('heading', { name: 'Facility maintenance and electrical upgrades', exact: true }).waitFor();
  });
  await auditExtendedWorkflows({ page, device, ids, base, out, check });
}

export async function auditRoles({ browser, device, width, height, base, out, results, failures, checkpoint }) {
  const routes = ['/today', '/pipeline', '/subs', '/communications', '/contracts', '/compliance', '/settings/profile', '/settings/content', '/settings/integrations', '/settings/api-usage', '/settings/rules', '/settings/billing', '/more'];
  for (const role of ['tenant-owner', 'admin', 'operator', 'member', 'viewer']) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: device !== 'desktop', hasTouch: device !== 'desktop' });
    await context.route('**/*', r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
    const page = await context.newPage();
    try {
      await page.goto(base + '/login');
      await page.getByLabel('Email', { exact: true }).fill(`ui-${role}@example.test`);
      await page.getByLabel('Password', { exact: true }).fill('DisposableUiAudit123!');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL('**/today', { timeout: 60000, waitUntil: 'networkidle' });
      for (const route of routes) {
        await page.goto(base + route, { waitUntil: 'networkidle' });
        assert.equal(new URL(page.url()).pathname, route);
        assert.equal(await page.getByRole('heading', { name: 'That page or record is unavailable', exact: true }).count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
        assert.equal(await page.getByRole('link', { name: 'Accounts', exact: true }).count(), 0, 'Tenant roles have no platform navigation');
        if (route === '/settings/profile' && ['operator', 'member', 'viewer'].includes(role)) assert(!(await page.getByRole('button', { name: 'Save profile', exact: true }).isEnabled()), 'The populated profile is readable but not editable');
        if (route === '/settings/integrations' && ['operator', 'member', 'viewer'].includes(role)) assert.equal(await page.locator('#sam input').count(), 0);
        if (route === '/contracts' && ['member', 'viewer'].includes(role)) assert.equal(await page.getByRole('button', { name: 'Record one by hand', exact: true }).count(), 0);
        if (route === '/subs' && role === 'viewer') assert.equal(await page.getByRole('button', { name: /^Edit contact info for/ }).count(), 0);
        if (route === '/compliance' && role === 'viewer') {
          assert.equal(await page.getByRole('button', { name: '+ Add your own item', exact: true }).count(), 0);
          assert.equal(await page.getByRole('button', { name: /^(Edit|Delete|Add file)$/ }).count(), 0);
          const title = page.getByText(`Insurance the contract requires (AUDIT-MANUAL-${device})`, { exact: true });
          const bounds = await title.boundingBox();
          assert(bounds && bounds.width >= 180, 'An undated compliance item must leave enough room to read its title');
          await title.scrollIntoViewIfNeeded();
          await page.screenshot({ path: join(out, `${device}-compliance-undated-card.png`) });
        }
        const screenshot = `${device}-${role}-${route.replaceAll('/', '_')}.png`;
        await page.screenshot({ path: join(out, screenshot) });
        results.push({ device, role, route, status: 'tenant route and role controls checked', screenshot });
      }
      await page.goto(base + '/admin/accounts', { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: 'That page or record is unavailable', exact: true }).waitFor();
      results.push({ device, role, route: '/admin/accounts', status: 'platform access denied as expected' });
    } catch (error) { failures.push({ device, role, task: 'role coverage', status: 'failed', url: page.url(), error: String(error.stack ?? error) }); }
    finally { await context.close(); checkpoint(); }
  }
}

/** Every viewport of each visible internal vertical scroller, with overlap. */
export async function captureScrollFrames(page, out, stem) {
  const panes = await page.evaluate(() => Array.from(document.querySelectorAll('main,main *')).filter(el =>
    el.getClientRects().length && el.clientHeight > 100 && el.scrollHeight > el.clientHeight + 30 && /auto|scroll/.test(getComputedStyle(el).overflowY)
  ).map((el, index) => {
    el.setAttribute('data-audit-scroll', String(index));
    return { index, height: el.clientHeight, total: el.scrollHeight, original: el.scrollTop };
  }));
  const frames = [];
  for (const pane of panes) {
    const positions = [];
    for (let top = 0; top < pane.total - pane.height; top += Math.max(100, Math.floor(pane.height * 0.85))) positions.push(top);
    positions.push(pane.total - pane.height);
    assert(positions.length < 100, 'Scroller is unexpectedly long; inspect it before accepting coverage');
    for (const [index, top] of positions.entries()) {
      await page.locator(`[data-audit-scroll="${pane.index}"]`).evaluate((el, y) => { el.scrollTop = y; }, top);
      const screenshot = `${stem}-pane${pane.index}-${index}.png`;
      await page.screenshot({ path: join(out, screenshot) });
      frames.push({ pane: pane.index, top, screenshot });
    }
    await page.locator(`[data-audit-scroll="${pane.index}"]`).evaluate((el, y) => { el.scrollTop = y; el.removeAttribute('data-audit-scroll'); }, pane.original);
  }
  return frames;
}
