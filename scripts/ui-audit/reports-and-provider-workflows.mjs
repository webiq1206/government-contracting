import assert from 'node:assert/strict';

/** Read-only checks against the disposable audit account; no provider tests or saves. */
export async function auditReportsAndProviderCopy({ page, device, ids, check }) {
  await check('/analytics?range=90', 'report-breakdown-navigation', async () => {
    const winView=page.getByRole('button',{name:'Win performance',exact:true});
    await winView.click();
    const controls=page.getByRole('group',{name:'Break down by',exact:true});
    for(const [label,key] of [['NAICS','naics'],['Trade','trade'],['Agency','agency']]) {
      const link=controls.getByRole('link',{name:label,exact:true});
      if(key==='trade') { await link.focus(); await page.keyboard.press('Enter'); }
      else await link.click();
      await page.waitForURL(url=>url.searchParams.get('by')===key,{timeout:15000});
      await page.getByRole('heading',{name:`Broken down by ${label.toLowerCase()}`,exact:true}).waitFor();
      assert.equal(await winView.getAttribute('aria-pressed'),'true','Applying a filter retains the focused report view');
      assert.equal(await controls.getByRole('link',{name:label,exact:true}).getAttribute('aria-current'),'true');
      assert.equal(new URL(page.url()).searchParams.get('range'),'90');
    }
    await page.goBack();
    await page.getByRole('heading',{name:'Broken down by trade',exact:true}).waitFor();
    assert.equal(await winView.getAttribute('aria-pressed'),'true');
    await page.goForward();
    await page.getByRole('heading',{name:'Broken down by agency',exact:true}).waitFor();
    await page.goBack();
    await page.reload();
    await page.getByRole('heading',{name:'Broken down by trade',exact:true}).waitFor();
    assert.equal(await winView.getAttribute('aria-pressed'),'true');
    await page.locator('#drilldown-heading').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  });
  await check('/analytics?range=30&by=naics&view=win-performance', 'report-direct-link-and-invalid-view', async () => {
    await page.getByRole('heading',{name:'Broken down by naics',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Win performance',exact:true}).getAttribute('aria-pressed'),'true');
    await page.goto(new URL('/analytics?range=30&by=naics&view=unknown',page.url()).href);
    await page.getByText('Top Subcontractors',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Overview',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'Win performance',exact:true}).click();
    await page.getByRole('heading',{name:'Broken down by naics',exact:true}).waitFor();
  });
  await check('/analytics?range=90', 'report-period-and-mobile-apply', async () => {
    await page.getByRole('button',{name:'Revenue',exact:true}).click();
    if(device==='desktop') {
      await page.getByRole('group',{name:'Period',exact:true}).getByRole('link',{name:'Last 30 days',exact:true}).click();
      await page.waitForURL(url=>url.searchParams.get('range')==='30');
    } else {
      await page.getByRole('button',{name:/Last 90 days.*by Agency/}).click();
      const dialog=page.getByRole('dialog',{name:'Filter analytics',exact:true});
      await dialog.getByRole('button',{name:'Last 30 days',exact:true}).click();
      await dialog.getByRole('button',{name:'NAICS',exact:true}).click();
      await dialog.getByRole('link',{name:'Show these',exact:true}).click();
      await page.waitForURL(url=>url.searchParams.get('range')==='30'&&url.searchParams.get('by')==='naics');
      assert.equal(await page.getByRole('dialog').count(),0);
      await page.getByRole('button',{name:/Last 30 days.*by NAICS/}).waitFor();
    }
    assert.equal(await page.getByRole('button',{name:'Revenue',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByText('Cash Flow Projection',{exact:true}).waitFor();
    await page.getByText('Cash Flow Projection',{exact:true}).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  });
  await check('/settings/integrations#openai', 'provider-copy-does-not-claim-active-fallback', async () => {
    for(const id of ['openai','claude']) {
      const card=page.locator(`#${id}`);
      await card.getByText(/Configured routing and spending controls determine which provider handles each request/).waitFor();
      await card.getByText(/Saving both keys does not by itself enable automatic fallback/).waitFor();
      assert.doesNotMatch(await card.innerText(),/either provider covers|run here at lower cost|fraction of a cent/i);
    }
    await page.locator('#openai').getByText(/Configured routing and spending controls/).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  });
  await check(`/admin/accounts/${ids.org}`, 'lent-provider-copy-does-not-claim-active-fallback', async () => {
    await page.getByRole('tab',{name:'Integrations',exact:true}).click();
    const section=page.locator('section').filter({has:page.getByRole('heading',{name:'Our API keys on this account',exact:true})});
    await section.getByText(/a grant record alone does not show which credential is in use/).waitFor();
    for(const name of ['OpenAI','Anthropic (Claude)']) {
      const row=section.getByRole('listitem').filter({has:page.getByText(name,{exact:true})});
      await row.getByText(/lending a key does not enable automatic fallback/).waitFor();
      assert.doesNotMatch(await row.innerText(),/cover for Anthropic|at lower cost|switched off|key always wins|They pay for this themselves/i);
    }
    await section.getByRole('listitem').filter({has:page.getByText('OpenAI',{exact:true})}).scrollIntoViewIfNeeded();
  });
}
