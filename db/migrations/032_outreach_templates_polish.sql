-- Polish outreach Template 1 and Template 2: clearer scan structure, no em
-- dashes, no highlight wrappers around {{questions}}, comma subjects.
-- Rewrites every row for those slugs so the live editor picks it up without
-- a full reseed.

UPDATE templates
SET subject = '{{trade}} Quote Request, {{location_state}}',
    body =
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
      '{{company_name}}',
    description = 'Template 1, initial subcontractor outreach (scannable quote request).'
WHERE slug = 'template_1_outreach';

UPDATE templates
SET subject = 'Re: {{trade}} Quote Request, {{location_state}}',
    body =
      'Hi {{owner_name}},' || chr(10) ||
      chr(10) ||
      'Checking in on the {{trade}} work in {{location_state}}. The bid deadline is {{deadline}}, so I need to hear back soon.' || chr(10) ||
      chr(10) ||
      'If you can price it, reply with your quote (payment terms and exclusions included). You can also call me at {{phone}}.' || chr(10) ||
      chr(10) ||
      '{{sender_name}}',
    description = 'Template 2, 48-hour follow-up (short, deadline-forward). One follow-up only; no third email.'
WHERE slug = 'template_2_followup';
