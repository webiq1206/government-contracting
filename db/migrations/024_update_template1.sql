-- Update Template 1 (initial outreach) to use natural first-person voice and
-- remove "federal contracting company" framing that anchors subs to higher
-- government rates. Also removes the dangling | {{phone}} from the signature.
-- Applies to all active versions so the change takes effect immediately without
-- a full reseed.
UPDATE templates
SET body =
  'Hi {{owner_name}},' || chr(10) ||
  '' || chr(10) ||
  'I''m {{sender_name}} with {{company_name}}. We have a {{trade}} job in {{location_state}} — deadline {{deadline}} — and need a qualified local partner to price the scope.' || chr(10) ||
  '' || chr(10) ||
  'Scope: {{scope_summary}}' || chr(10) ||
  '' || chr(10) ||
  '{{questions}}' || chr(10) ||
  '' || chr(10) ||
  'If this is something your team handles, please reply with your price (include payment terms and any exclusions). I''d also like to set up a quick call if it''s a fit.' || chr(10) ||
  '' || chr(10) ||
  '{{sender_name}}' || chr(10) ||
  '{{company_name}}'
WHERE slug = 'template_1_outreach';
