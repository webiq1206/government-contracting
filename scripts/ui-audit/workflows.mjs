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
    console.log(JSON.stringify({ device, route, task, status: record.status, error: record.error }));
  };
  await check('/analytics', 'focused-report-views', async () => {
    const views=page.getByRole('group',{name:'Report view',exact:true});
    await views.waitFor();
    for(const label of ['Overview','Pipeline','Win performance','Revenue']) {
      const control=views.getByRole('button',{name:label,exact:true});
      await control.click();
      assert.equal(await control.getAttribute('aria-pressed'),'true');
      if(label==='Overview') assert(await page.getByText('Top Subcontractors',{exact:true}).isVisible());
      if(label==='Pipeline') {
        assert(await page.getByText('Opportunities by stage',{exact:true}).isVisible());
        assert(await page.getByText('Recorded pipeline value',{exact:true}).isVisible());
        assert.equal(await page.getByText('Active contract revenue',{exact:true}).isVisible(),false);
      }
      if(label==='Win performance') {
        assert(await page.getByText('Avg margin on wins',{exact:true}).isVisible());
        assert(await page.getByRole('heading',{name:'Win rate by NAICS',exact:true}).isVisible());
      }
      if(label==='Revenue') {
        assert(await page.getByText('Active contract revenue',{exact:true}).isVisible());
        assert(await page.getByText('Cash Flow Projection',{exact:true}).isVisible());
        assert(await page.getByText('Not projected',{exact:true}).isVisible());
        assert.equal(await page.getByText('Recorded pipeline value',{exact:true}).isVisible(),false);
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
      await page.screenshot({path:join(out,`${device}-reports-${label.toLowerCase().replaceAll(' ','-')}.png`),fullPage:true});
    }
    if(device!=='desktop') {
      const trigger=page.getByRole('button',{name:/Last 90 days.*by Agency/});
      await trigger.click();
      const dialog=page.getByRole('dialog',{name:'Filter analytics',exact:true});
      await dialog.waitFor();
      await dialog.getByRole('button',{name:'Close',exact:true}).waitFor();
      assert(await dialog.getByRole('button',{name:'Close',exact:true}).evaluate(node=>node===document.activeElement));
      await page.keyboard.press('Shift+Tab');
      assert(await dialog.getByRole('link',{name:'Show these',exact:true}).evaluate(node=>node===document.activeElement));
      await page.keyboard.press('Tab');
      assert(await dialog.getByRole('button',{name:'Close',exact:true}).evaluate(node=>node===document.activeElement));
      await page.evaluate(()=>document.querySelector('main a')?.focus());
      assert(await dialog.evaluate(node=>node.contains(document.activeElement)),'Native modal prevents background focus');
      await page.screenshot({path:join(out,`${device}-analytics-filter-dialog.png`)});
      await page.keyboard.press('Escape');
      assert.equal(await dialog.count(),0); assert(await trigger.evaluate(node=>node===document.activeElement));
    }
  });
  await check('/search?q=Connections', 'navigation-only-search', async () => {
    await page.locator('main a[href="/settings/integrations"]').first().waitFor();
    await page.goto(base+'/search?q=Reports',{waitUntil:'networkidle'});
    await page.locator('main a[href="/analytics"]').first().waitFor();
    await page.goto(base+'/search?q=Review&kind=page',{waitUntil:'networkidle'});
    await page.locator('main a[href="/review"]').first().waitFor();
    await page.keyboard.press('Control+k');
    const search=page.getByRole('combobox',{name:/Search pages, opportunities/});
    await search.fill('Connections');
    await page.getByRole('group',{name:'Pages & tools',exact:true}).getByRole('option').first().waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
    await page.keyboard.press('Escape');
  });
  await check(`/opportunity/${ids.sourceAudit}/requirements`, 'requirement-source-page-alignment', async () => {
    const frame=page.locator('iframe');
    assert.equal(await frame.getAttribute('src'),`/api/documents/${ids.sourceDocs[1]}/open?page=44`);
    await page.getByText('Synthetic requirement page 44',{exact:true}).first().click();
    await page.getByLabel('The document',{exact:true}).selectOption(ids.sourceDocs[0]);
    assert.equal(await frame.getAttribute('src'),`/api/documents/${ids.sourceDocs[0]}/open`);
    await page.getByRole('button',{name:'Show where it says so',exact:true}).click();
    assert.equal(await frame.getAttribute('src'),`/api/documents/${ids.sourceDocs[1]}/open?page=44`);
    await page.getByRole('button',{name:'Next requirement',exact:true}).click();
    assert.equal(await frame.getAttribute('src'),`/api/documents/${ids.sourceDocs[1]}/open?page=12`);
    await page.getByRole('button',{name:'Next requirement',exact:true}).click();
    assert.equal(await frame.getAttribute('src'),`/api/documents/${ids.sourceDocs[1]}/open`);
    assert(await page.getByText(/browsing context, not evidence for this requirement/).isVisible());
    if(device!=='desktop') await page.getByRole('button',{name:'Back to the checklist',exact:true}).click();
    await page.getByRole('button',{name:/^Ask the agency/}).click();
    assert.equal(await frame.getAttribute('src'),`/api/documents/${ids.sourceDocs[1]}/open?page=12`);
    if(device!=='desktop') await page.getByText('Synthetic requirement page 12',{exact:true}).first().click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  });
  await check(`/opportunity/${ids.opportunity}`, 'guide-answer-source-links', async () => {
    const askPattern='**/api/guide/ask';
    await page.route(askPattern,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      answer:'Synthetic answer based on saved fixture facts.',sources:[
        {label:'A long descriptive source label for the synthetic opportunity record, with enough detail to check phone wrapping safely',href:`/opportunity/${ids.opportunity}#brief`},
        {label:'Untrusted external source',href:'https://invalid.example'},
        {label:'Wrong record',href:`/opportunity/${ids.research}#brief`}
      ]})}));
    try {
      await page.evaluate(()=>window.dispatchEvent(new Event('open-guide-wizard')));
      const dialog=page.getByRole('dialog'); await dialog.waitFor();
      await dialog.getByRole('button',{name:'Ask',exact:true}).click();
      await dialog.getByLabel('Ask about this page',{exact:true}).fill('What needs attention?');
      await dialog.locator('form').getByRole('button',{name:'Ask',exact:true}).click();
      await dialog.getByText('Synthetic answer based on saved fixture facts.',{exact:false}).first().waitFor();
      const source=dialog.locator(`a[href="/opportunity/${ids.opportunity}#brief"]`); await source.waitFor();
      assert.equal(await dialog.getByText('Untrusted external source',{exact:true}).count(),0);
      assert.equal(await dialog.getByText('Wrong record',{exact:true}).count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
      await page.screenshot({path:join(out,`${device}-guide-source-citations.png`)});
      await source.focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(()=>location.hash==='#brief');
      assert.equal(await page.getByRole('dialog').count(),0);
    } finally { await page.unroute(askPattern); }
  });
  await check('/settings/profile', 'in-flow-analytics-preferences', async () => {
    const control=page.getByRole('button',{name:'Analytics preferences',exact:true}); await control.waitFor();
    assert(await control.evaluate(node=>!['fixed','absolute'].includes(getComputedStyle(node).position)));
    assert.equal(await page.locator('button').evaluateAll(nodes=>nodes.some(node=>node.textContent==='Analytics preferences'&&getComputedStyle(node).position==='fixed')),false);
    // Loopback deliberately disables trackers. Consent choice/withdrawal is
    // verified separately with mocked providers, not enabled by this audit.
    assert(await control.isDisabled());
  });
  await check('/today', 'empty-account-setup-link', async () => {
    const isolated=await page.context().browser().newContext({viewport:page.viewportSize()});
    await isolated.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const empty=await isolated.newPage();
    try {
      await empty.goto(base+'/login');
      await empty.getByLabel('Email',{exact:true}).fill('ui-setup@example.test');
      await empty.getByLabel('Password',{exact:true}).fill('DisposableUiAudit123!');
      await empty.getByRole('button',{name:'Sign in',exact:true}).click();
      await empty.waitForURL('**/today',{waitUntil:'networkidle'});
      await empty.getByRole('link',{name:'Continue setup',exact:true}).click();
      await empty.waitForFunction(()=>location.hash==='#setup-checklist'&&document.querySelector('[data-today-details]')?.open);
      const setup=empty.locator('#setup-checklist'); assert(await setup.isVisible());
      assert(await setup.locator('a[href^="/settings/"]').count()>0);
      await empty.screenshot({path:join(out,`${device}-empty-setup-checklist.png`)});
      await empty.goto(base+'/analytics',{waitUntil:'networkidle'});
      const views=empty.getByRole('group',{name:'Report view',exact:true});
      await views.getByRole('button',{name:'Revenue',exact:true}).click();
      assert.equal(await empty.getByText('Cash Flow Projection',{exact:true}).count(),0,'No stored projection must stay absent');
      await empty.screenshot({path:join(out,`${device}-reports-no-snapshot.png`)});
      await empty.goto(base+'/search?q=Accounts',{waitUntil:'networkidle'});
      assert.equal(await empty.locator('main a[href^="/admin/"]').count(),0,'A tenant owner never receives platform destinations');
    } finally { await isolated.close(); }
  });
  await check(`/opportunity/${ids.archived}`, 'archived-document-coverage', async () => {
    await page.getByRole('heading', { name: 'Archived document coverage audit', exact: true }).waitFor();
    assert.equal(await page.getByText('Calls to make', { exact: true }).count(), 0, 'An archived record must not advertise active calls');
    await page.getByText('Closed record', { exact: true }).waitFor();
    assert.equal(await page.getByRole('link', {name: /Start calling/}).count(), 0);
    await page.getByRole('tab', { name: 'Documents', exact: true }).click();
    await page.getByText('11 of 13 document(s) read in full; 1 only partly read, 1 marked as having no text.', { exact: true }).waitFor();
    const visibleReadLabels = await page.getByText('Read in full', { exact: true }).evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).length);
    assert.equal(visibleReadLabels, 11, 'Summary must agree with the visible document rows/cards');
    assert.equal(await page.getByText('No text to read', { exact: true }).evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).length), 1);
    assert.equal(await page.getByText('Partly read', { exact: true }).evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).length), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
  });
  await check('/settings/content', 'template-preview-sample-fallback', async () => {
    await page.getByRole('button', { name: 'Preview email', exact: true }).first().click();
    const picker = page.getByLabel('Preview against', { exact: true });
    await picker.waitFor();
    // This fixture has no contactable saved pairing. Research and guesses must
    // not be invented simply to populate the picker.
    await page.getByText('No active saved subcontractor associations on open bids are available. Use sample values; Sources Sought is market research.', { exact: true }).waitFor();
    assert.equal(await picker.locator('option').count(), 1);
    assert.equal(await picker.inputValue(), '');
    assert.equal(await page.getByText(/firm whose trades match/).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Preview email', exact: true }).first().click();
    assert.equal(await picker.inputValue(), '');
  });
  await check(`/opportunity/${ids.research}`, 'sources-sought-research-history', async () => {
    await page.getByRole('heading', { name: 'Historical Sources Sought audit', exact: true }).waitFor();
    assert(await page.getByRole('heading', { name: 'Notice summary', exact: true }).isVisible());
    assert(await page.getByText('Recorded warnings', { exact: true }).isVisible());
    for (const text of ['Bid Brief', 'Where this bid stands', 'Readiness and full workflow', 'Jump to Next step', 'Pursuit controls', 'Who does the work']) {
      assert.equal(await page.getByText(text, { exact: true }).count(), 0, `Research must not show ${text}`);
    }
    assert.equal(await page.locator('a[href="#next-step"]').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    await page.getByRole('tab', { name: 'Pricing', exact: true }).click();
    assert(await page.getByRole('heading', { name: 'Saved pricing history', exact: true }).isVisible());
    assert.equal(await page.getByText('Enter subcontractor quotes', { exact: true }).count(), 0);
    await page.getByRole('tab', { name: 'Submission', exact: true }).click();
    assert(await page.getByRole('heading', { name: 'Saved submission history', exact: true }).isVisible());
    assert.equal(await page.getByRole('button', { name: 'Approve this package', exact: true }).count(), 0);
    await page.getByRole('tab', { name: 'Subcontractors', exact: true }).click();
    assert(await page.getByText('Saved subcontractor history', { exact: true }).isVisible());
    assert(await page.getByText('Sample Electrical Services', { exact: true }).isVisible());
    assert.equal(await page.getByText('Enter quote', { exact: true }).count(), 0);
    assert.equal(await page.getByText(/Collect or confirm their quote/).count(), 0);
    assert.equal(await page.getByText(/Re-run the analysis to break it out/).count(), 0);
    assert(await page.getByText('Saved description: Electrical', { exact: true }).isVisible());
    assert.equal(await page.locator('a[href="#quotes"]').count(), 0);
  });
  await check(`/opportunity/${ids.research}/requirements`, 'sources-sought-requirements-read-only', async () => {
    await page.getByRole('heading', { name: 'Saved notice requirements', exact: true }).waitFor();
    await page.getByText('Provide a capability statement for agency market research.', { exact: true }).first().click();
    await page.getByRole('heading', { name: 'Provide a capability statement for agency market research.', exact: true }).waitFor();
    assert.equal(await page.getByText('The solicitation states this as a condition of a valid bid.', { exact: true }).count(), 0);
    assert(await page.getByText('This requirement comes from the saved notice information. Verify it against the original market research notice.', { exact: true }).isVisible());
    await page.locator('summary').filter({ hasText: 'History for Provide a capability statement for agency market research.' }).click();
    assert(await page.getByText('Saved historical requirement note', { exact: true }).isVisible());
    assert.equal(await page.getByRole('button', { name: 'Update', exact: true }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'What it takes to bid', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
  });
  await check('/communications?c=clarity-audit-thread', 'email-message-separation', async () => {
    await page.getByText('Latest message', { exact: true }).waitFor();
    assert(await page.getByText('Friday works.', { exact: true }).isVisible());
    const recordedTimes = await page.locator('article time').allTextContents();
    assert(recordedTimes.length > 0 && recordedTimes.every(text => text.startsWith('Recorded: ') && text.endsWith(' UTC')), 'All message times must identify the same recorded UTC clock');
    const earlier = page.getByText('Earlier messages (1)', { exact: true });
    assert.equal(await earlier.evaluate(node => node.parentElement.open), false);
    await earlier.click();
    assert(await page.getByText('Please quote the electrical work.', { exact: true }).isVisible());
    const quoted = page.getByText('Show quoted history', { exact: true });
    assert.equal(await quoted.evaluate(node => node.parentElement.open), false);
    await quoted.click();
    assert.equal(await quoted.evaluate(node => node.parentElement.open), true);
    await page.getByLabel('Unsent reply to Sample Electrical Services').fill('Draft for review only.');
    assert.equal(await page.getByLabel('Unsent reply to Sample Electrical Services').inputValue(), 'Draft for review only.');
    await page.getByLabel('Unsent reply to Sample Electrical Services').fill('');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
  });
  await check('/today', 'focused-today-disclosure-and-saved-links', async () => {
    const details = page.locator('[data-today-details]');
    assert.equal(await details.evaluate(node => node.open), false, 'Full task views start collapsed');
    assert.equal(await page.locator('[data-next-task]').count(), 1, 'Today has one next task');
    assert(await page.locator('[data-upcoming-task]').count() <= 3, 'Upcoming work stays focused');
    await details.locator('summary').first().click();
    assert.equal(await details.evaluate(node => node.open), true);
    await page.goto(base + '/today#calls', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('[data-today-details]')?.open);
    assert(await page.locator('#calls').isVisible(), 'Saved task links reveal their original section');
    await page.goto(base + '/today?due=overdue#queue', { waitUntil: 'networkidle' });
    assert.equal(await details.evaluate(node => node.open), true, 'Active queue filters remain visible');
    assert(await page.locator('#queue').isVisible());
  });
  if (device === 'desktop') await check('/agents', 'latest-navigation-replaces-stalled-link', async () => {
    let releaseToday, releasePipeline;
    const todayGate = new Promise(resolve => { releaseToday = resolve; });
    const pipelineGate = new Promise(resolve => { releasePipeline = resolve; });
    const destinations = url => ['/today', '/pipeline'].includes(url.pathname);
    await page.route(destinations, async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (route.request().headers().rsc === '1') {
        await (url.pathname === '/today' ? todayGate : pipelineGate);
      }
      // This handler owns the delayed request through completion. Passing an
      // aborted navigation to another handler can race with route cleanup.
      // The origin check above preserves the context's local-only policy.
      await route.continue();
    });
    try {
      const nav = page.getByRole('navigation', { name: 'Main', exact: true });
      const today = nav.getByRole('link', { name: /^Today/ });
      const pipeline = nav.getByRole('link', { name: 'Opportunities', exact: true });
      await today.click();
      await today.getByRole('status').waitFor();
      await pipeline.click();
      await pipeline.getByRole('status').waitFor();
      await today.getByRole('status').waitFor({ state: 'hidden' });
      releasePipeline();
      await page.waitForURL(url => url.pathname === '/pipeline', { timeout: 15000 });
      releaseToday();
      await pipeline.getByRole('status').waitFor({ state: 'hidden' });
      await page.waitForLoadState('networkidle');
      assert.equal(new URL(page.url()).pathname, '/pipeline', 'The latest destination wins after the old request resolves');
    } finally {
      releaseToday(); releasePipeline();
      // Wait for both released handlers before removing them. Removing a
      // suspended handler can race with the context's request continuation.
      await page.unrouteAll({ behavior: 'wait' });
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
  await check(`/review?o=${ids.opportunity}`, 'review-inline-decision-keyboard-and-recovery', async () => {
    const decision = page.getByRole('region', { name: 'Your decision', exact: true });
    const pass = decision.getByRole('button', { name: 'Pass', exact: true });
    await pass.press('Enter');
    const reason = decision.getByRole('textbox', { name: 'Why are you passing?', exact: true });
    assert(await reason.evaluate(el => el === document.activeElement), 'Pass must focus the reason field');
    const confirm = decision.getByRole('button', { name: 'Confirm pass', exact: true });
    assert(await confirm.isDisabled(), 'An empty reason must not submit');
    await reason.fill('We are already at capacity.');
    const endpoint = `**/api/opportunities/${ids.opportunity}/action`;
    let attempts = 0;
    let responseStatus = 403;
    await page.route(endpoint, route => { attempts++; return route.fulfill({ status: responseStatus, contentType: 'application/json', body: '{"error":"Fixture refusal or lost outcome"}' }); });
    try {
      await confirm.press('Enter');
      await decision.getByRole('alert').filter({ hasText: 'Your account cannot perform this action.' }).waitFor();
      assert.equal(await reason.inputValue(), 'We are already at capacity.', 'A refused decision must keep the reason');
      assert.equal(attempts, 1);
      await reason.press('Escape');
      await pass.waitFor();
      await page.waitForFunction(() => document.activeElement?.textContent === 'Pass');
      assert(await pass.evaluate(el => el === document.activeElement), 'Cancel must return focus to Pass');
      for (const button of await decision.getByRole('button').all()) {
        const box = await button.boundingBox();
        assert(box && box.height >= 44, 'Decision actions must have a44px touch target');
      }
      responseStatus = 503;
      await pass.press('Enter');
      assert.equal(await reason.inputValue(), 'We are already at capacity.');
      await confirm.press('Enter');
      await decision.getByRole('alert').filter({ hasText: 'The action could not be confirmed.' }).waitFor();
      assert(await confirm.isDisabled(), 'An unknown outcome must block a duplicate decision');
      await reason.press('Escape');
      const status = decision.getByRole('link', { name: "Check this opportunity's current status", exact: true });
      await page.waitForFunction(() => document.activeElement?.textContent === "Check this opportunity's current status");
      assert(await status.evaluate(el => el === document.activeElement), 'Unknown outcomes return focus to the status check');
      assert(await pass.isDisabled(), 'Cancellation must preserve the unknown-outcome retry lock');
      assert.equal(attempts, 2);
    } finally { await page.unroute(endpoint); }
  });
  await check('/review', 'nested-confirmation-and-keyboard', async () => {
    // Review uses its inline decision panel; saved drawer links remain supported.
    await page.goto(`${base}/review?peek=opportunity:${ids.opportunity}`, { waitUntil: 'networkidle' });
    const drawer = page.getByRole(device === 'desktop' ? 'complementary' : 'dialog', { name: 'Record details', exact: true });
    await drawer.waitFor();
    await drawer.getByRole('button', { name: /^More actions/ }).click();
    const menu = drawer.getByRole('menu');
    await menu.waitFor();
    if (device === 'desktop') {
      const menuBounds = await menu.boundingBox();
      const drawerBounds = await drawer.boundingBox();
      assert(menuBounds && drawerBounds);
      assert(menuBounds.y >= drawerBounds.y && menuBounds.y + menuBounds.height <= drawerBounds.y + drawerBounds.height,
        'The whole action menu must fit inside the desktop drawer, not be clipped below its footer');
      await menu.screenshot({ path: join(out, `${device}-drawer-actions.png`) });
    }
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
  const routes = ['/today', '/pipeline', '/subs', '/communications', '/communications/history', '/contracts', '/compliance', '/settings/profile', '/settings/content', '/settings/integrations', '/settings/api-usage', '/settings/rules', '/settings/billing', '/more'];
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
