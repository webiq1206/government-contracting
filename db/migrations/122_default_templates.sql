-- Default email templates for the founding organization, from the schema.
--
-- The five default templates were only ever written by the seed script. An
-- install that ran the migrations and skipped the seed (a fresh disposable
-- database for the release gate, a new deployment brought up from the
-- migrations alone) had no active template_1_outreach and refused every
-- outreach send with "no active template_1_outreach template". The 48-hour
-- follow-up then fell back to a two-line nudge with no quote date and no
-- "Follow-up" subject.
--
-- Templates are copy-on-write: customers inherit the founding organization's
-- rows until they save their own. Each insert below runs only where the
-- founding organization holds no row for that slug, so an install whose
-- defaults were seeded or edited keeps them exactly as they are. The text is
-- the same as db/seedData.ts; the seed script skips a slug that already has
-- an active row, so the two cannot disagree on a database that ran this.

-- template_1_outreach
INSERT INTO templates (org_id, slug, version, is_active, subject, body, description)
SELECT '00000000-0000-4000-8000-000000000001'::uuid, 'template_1_outreach', 1, true,
       'Pricing request: {{trade}} | {{location_city_state}}',
       'Hi {{owner_name}},' || chr(10) ||
      '' || chr(10) ||
      'I''m {{sender_name}} with {{company_name}}. We''re preparing a bid for {{trade}} work in {{location_city_state}} and would like your pricing for the scope below.' || chr(10) ||
      '' || chr(10) ||
      'Please review the complete scope, requirements, and attached bid documents. If your team can perform the complete trade scope, reply by {{quote_due_date}} with your price, availability, payment terms, and exclusions.' || chr(10) ||
      '' || chr(10) ||
      'If you can perform only part of the scope, please explain exactly what you can and cannot provide. If you''re not interested, a quick "pass" is helpful. If someone else handles estimates, please point me in the right direction.' || chr(10) ||
      '' || chr(10) ||
      'Thanks,' || chr(10) ||
      '{{sender_name}}' || chr(10) ||
      '{{company_name}}' || chr(10) ||
      '{{phone}}',
       'Template 1, initial subcontractor outreach. The project, scope, requirements, questions, quote checklist and document list are appended automatically beneath this body.'
 WHERE NOT EXISTS (
   SELECT 1 FROM templates
    WHERE slug = 'template_1_outreach'
      AND org_id = '00000000-0000-4000-8000-000000000001'::uuid
 );

-- template_2_followup
INSERT INTO templates (org_id, slug, version, is_active, subject, body, description)
SELECT '00000000-0000-4000-8000-000000000001'::uuid, 'template_2_followup', 1, true,
       NULL,
       'Hi {{owner_name}},' || chr(10) ||
      '' || chr(10) ||
      'I''m following up on the {{trade}} pricing request for {{opportunity_title}} in {{location_city_state}}.' || chr(10) ||
      '' || chr(10) ||
      'Can your team provide pricing by {{quote_due_date}}? A quick "interested" or "pass" is enough for now. The complete scope, requirements, and documents are included in the original message below.' || chr(10) ||
      '' || chr(10) ||
      'Thanks,' || chr(10) ||
      '{{sender_name}}' || chr(10) ||
      '{{phone}}',
       'Template 2, 48-hour follow-up sent inside the original email thread. The subject is inherited from the original message. Scope and attachments are not repeated because they are already in the conversation.'
 WHERE NOT EXISTS (
   SELECT 1 FROM templates
    WHERE slug = 'template_2_followup'
      AND org_id = '00000000-0000-4000-8000-000000000001'::uuid
 );

-- template_2_followup_new_thread
INSERT INTO templates (org_id, slug, version, is_active, subject, body, description)
SELECT '00000000-0000-4000-8000-000000000001'::uuid, 'template_2_followup_new_thread', 1, true,
       'Follow-up: {{trade}} pricing request | {{location_city_state}}',
       'Hi {{owner_name}},' || chr(10) ||
      '' || chr(10) ||
      'I''m following up on our request for {{trade}} pricing for {{opportunity_title}} in {{location_city_state}}.' || chr(10) ||
      '' || chr(10) ||
      'The complete scope, requirements, and bid documents are included again below and attached to this email. Please reply by {{quote_due_date}} with your price, availability, payment terms, and exclusions.' || chr(10) ||
      '' || chr(10) ||
      'If you can perform only part of the scope, please explain exactly what you can and cannot provide. If you''re not interested, a quick "pass" is helpful.' || chr(10) ||
      '' || chr(10) ||
      'Thanks,' || chr(10) ||
      '{{sender_name}}' || chr(10) ||
      '{{company_name}}' || chr(10) ||
      '{{phone}}',
       'Template 2 fallback, used only when the original thread cannot be replied to. Carries the complete scope, requirements and document package.'
 WHERE NOT EXISTS (
   SELECT 1 FROM templates
    WHERE slug = 'template_2_followup_new_thread'
      AND org_id = '00000000-0000-4000-8000-000000000001'::uuid
 );

-- template_3_sources_sought
INSERT INTO templates (org_id, slug, version, is_active, subject, body, description)
SELECT '00000000-0000-4000-8000-000000000001'::uuid, 'template_3_sources_sought', 1, true,
       'Sources Sought Response, {{solicitation_number}}, {{company_name}}',
       '{{co_name}},' || chr(10) ||
      '' || chr(10) ||
      '{{company_name}} (UEI: {{uei}}, CAGE: {{cage_code}}) submits this response to the Sources Sought notice for {{opportunity_title}}.' || chr(10) ||
      '' || chr(10) ||
      'We are an active Small Business registered in SAM.gov with primary NAICS {{naics_code}}. We have the capability to perform the described requirements through our established network of qualified, licensed {{trade}} subcontractors.' || chr(10) ||
      '' || chr(10) ||
      'We intend to bid on the resulting solicitation and request that this procurement be set aside for Small Businesses per FAR 19.502-2. Our capability statement is attached.' || chr(10) ||
      '' || chr(10) ||
      '{{sender_name}}' || chr(10) ||
      '{{company_name}} | {{phone}} | {{email}}' || chr(10) ||
      'UEI: {{uei}} | CAGE: {{cage_code}}',
       'Template 3, Sources Sought capability response (queued for human send within 24h).'
 WHERE NOT EXISTS (
   SELECT 1 FROM templates
    WHERE slug = 'template_3_sources_sought'
      AND org_id = '00000000-0000-4000-8000-000000000001'::uuid
 );

-- template_4_cpars
INSERT INTO templates (org_id, slug, version, is_active, subject, body, description)
SELECT '00000000-0000-4000-8000-000000000001'::uuid, 'template_4_cpars', 1, true,
       'CPARS Evaluation Request, Contract {{contract_number}}',
       '{{co_name}},' || chr(10) ||
      '' || chr(10) ||
      'I''m writing to request that a Contractor Performance Assessment Report be completed for our performance on Contract {{contract_number}}, which concluded on {{end_date}}.' || chr(10) ||
      '' || chr(10) ||
      'Please let me know if you need any supporting information from us.' || chr(10) ||
      '' || chr(10) ||
      'Thank you for the opportunity to serve {{agency}}.' || chr(10) ||
      '' || chr(10) ||
      '{{sender_name}} | {{company_name}}',
       'Template 4, CPARS request, queued 7 days after contract close.'
 WHERE NOT EXISTS (
   SELECT 1 FROM templates
    WHERE slug = 'template_4_cpars'
      AND org_id = '00000000-0000-4000-8000-000000000001'::uuid
 );
