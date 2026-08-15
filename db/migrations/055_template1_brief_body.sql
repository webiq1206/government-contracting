-- Template 1 no longer restates what the structured brief already says.
--
-- The Outreach agent now appends a brief (Project / Scope we need priced /
-- Schedule / What to send back / Worth knowing / Documents). The body written
-- by migration 032 carried the trade, location and deadline in its opening
-- sentence, the scope again under "What we need you to price", and the reply
-- instructions again at the end, so a subcontractor read the same facts twice,
-- once as prose and once as bullets. {{questions}} now resolves to nothing,
-- because those questions are a section of the brief.
--
-- Only rows still holding the verbatim 032 default are rewritten. An operator
-- who has edited their template keeps their wording; this migration must not
-- silently discard it.

UPDATE templates
SET body =
      'Hi {{owner_name}},' || chr(10) ||
      chr(10) ||
      'I''m {{sender_name}} with {{company_name}}. We''re bidding a project that needs {{trade}} work, and I''d like your price on that scope.' || chr(10) ||
      chr(10) ||
      'Everything you need is below. Reply here with any questions, or call me at {{phone}}.' || chr(10) ||
      chr(10) ||
      '{{sender_name}}' || chr(10) ||
      '{{company_name}}'
WHERE slug = 'template_1_outreach'
  AND body =
      'Hi {{owner_name}},' || chr(10) ||
      chr(10) ||
      'I''m {{sender_name}} with {{company_name}}. We have a {{trade}} job in {{location_state}} (deadline {{deadline}}) and need a qualified local partner to price the work.' || chr(10) ||
      chr(10) ||
      '**What we need you to price:**' || chr(10) ||
      '{{scope_summary}}' || chr(10) ||
      chr(10) ||
      '{{questions}}' || chr(10) ||
      chr(10) ||
      'Please reply with your price, including payment terms, lead time, and any exclusions. If it looks like a fit, I would also like to set up a short call.' || chr(10) ||
      chr(10) ||
      '{{sender_name}}' || chr(10) ||
      '{{company_name}}';
