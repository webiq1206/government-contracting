-- Remove em dashes from active Template 1 outreach copy.
update templates
   set body = replace(body, '—', '-'),
       updated_at = now()
 where slug = 'template_1_outreach'
   and is_active = true
   and body like '%—%';
