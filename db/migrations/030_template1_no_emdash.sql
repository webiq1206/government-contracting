-- Remove em dashes from active Template 1 outreach copy.
-- templates.updated_at is not present on all installs; only rewrite body.
update templates
   set body = replace(body, '—', '-')
 where slug = 'template_1_outreach'
   and is_active = true
   and body like '%—%';
