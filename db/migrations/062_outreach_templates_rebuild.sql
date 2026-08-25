-- Rebuild the subcontractor outreach templates around the new variable system.
--
-- Three things change.
--
-- 1. The initial email stops handing subcontractors the government's bid
--    deadline as though it were their own. {{quote_due_date}} is computed back
--    from {{deadline}} with enough working time to review a price, chase a
--    replacement if it is unusable, apply markup and assemble the package.
--
-- 2. The 48-hour follow-up gets a second body. When the follow-up genuinely
--    lands inside the original Gmail thread the scope and documents are
--    already sitting underneath it, so repeating them is noise; when it cannot
--    and a new thread is the only option, the email must stand entirely on its
--    own. Sending the short version into a new thread is how a subcontractor
--    receives a chaser referring to a message they cannot see.
--
-- 3. Location moves from {{location_state}} to {{location_city_state}}. "an
--    HVAC job in Virginia" is not somewhere a crew can be priced to.
--
-- Scoped to the platform default rows only. Templates are copy-on-write: an
-- organization owns a row for a slug only once it has saved its own edit, so
-- rewriting the defaults reaches every org still inheriting them while leaving
-- customers' own wording alone. An org that customised its outreach template
-- keeps it, and the editor's validation is what tells them their copy is
-- presenting the bid deadline as the subcontractor's reply date.

-- --------------------------------------------------------------------------
-- Template 1: initial outreach.
-- --------------------------------------------------------------------------
UPDATE templates
SET subject = 'Pricing request: {{trade}} | {{location_city_state}}',
    body =
      'Hi {{owner_name}},' || chr(10) ||
      chr(10) ||
      'I''m {{sender_name}} with {{company_name}}. We''re preparing a bid for {{trade}} work in {{location_city_state}} and would like your pricing for the scope below.' || chr(10) ||
      chr(10) ||
      'Please review the complete scope, requirements, and attached bid documents. If your team can perform the complete trade scope, reply by {{quote_due_date}} with your price, availability, payment terms, and exclusions.' || chr(10) ||
      chr(10) ||
      'If you can perform only part of the scope, please explain exactly what you can and cannot provide. If you''re not interested, a quick "pass" is helpful. If someone else handles estimates, please point me in the right direction.' || chr(10) ||
      chr(10) ||
      'Thanks,' || chr(10) ||
      '{{sender_name}}' || chr(10) ||
      '{{company_name}}' || chr(10) ||
      '{{phone}}',
    description = 'Template 1, initial subcontractor outreach. The project, scope, requirements, questions, quote checklist and document list are appended automatically beneath this body.'
WHERE slug = 'template_1_outreach'
  AND org_id = '00000000-0000-4000-8000-000000000001';

-- --------------------------------------------------------------------------
-- Template 2: the 48-hour follow-up, sent as a reply inside the original
-- thread. No subject: replies keep the original one, and an editable subject
-- here would be a field that silently does nothing.
-- --------------------------------------------------------------------------
UPDATE templates
SET subject = NULL,
    body =
      'Hi {{owner_name}},' || chr(10) ||
      chr(10) ||
      'I''m following up on the {{trade}} pricing request for {{opportunity_title}} in {{location_city_state}}.' || chr(10) ||
      chr(10) ||
      'Can your team provide pricing by {{quote_due_date}}? A quick "interested" or "pass" is enough for now. The complete scope, requirements, and documents are included in the original message below.' || chr(10) ||
      chr(10) ||
      'Thanks,' || chr(10) ||
      '{{sender_name}}' || chr(10) ||
      '{{phone}}',
    description = 'Template 2, 48-hour follow-up sent inside the original email thread. The subject is inherited from the original message. Scope and attachments are not repeated because they are already in the conversation.'
WHERE slug = 'template_2_followup'
  AND org_id = '00000000-0000-4000-8000-000000000001';

-- --------------------------------------------------------------------------
-- Template 2, fallback: used ONLY when the original thread cannot be replied
-- to. Self-contained, and the generated sections and full attachment package
-- ride along with it exactly as they did on the first email.
-- --------------------------------------------------------------------------
INSERT INTO templates (org_id, slug, version, is_active, subject, body, description)
SELECT
  t.org_id,
  'template_2_followup_new_thread',
  1,
  true,
  'Follow-up: {{trade}} pricing request | {{location_city_state}}',
  'Hi {{owner_name}},' || chr(10) ||
  chr(10) ||
  'I''m following up on our request for {{trade}} pricing for {{opportunity_title}} in {{location_city_state}}.' || chr(10) ||
  chr(10) ||
  'The complete scope, requirements, and bid documents are included again below and attached to this email. Please reply by {{quote_due_date}} with your price, availability, payment terms, and exclusions.' || chr(10) ||
  chr(10) ||
  'If you can perform only part of the scope, please explain exactly what you can and cannot provide. If you''re not interested, a quick "pass" is helpful.' || chr(10) ||
  chr(10) ||
  'Thanks,' || chr(10) ||
  '{{sender_name}}' || chr(10) ||
  '{{company_name}}' || chr(10) ||
  '{{phone}}',
  'Template 2 fallback, used only when the original thread cannot be replied to. Carries the complete scope, requirements and document package, because the recipient has no earlier message to refer back to.'
FROM (
  SELECT DISTINCT org_id FROM templates
   WHERE slug = 'template_2_followup'
     AND org_id = '00000000-0000-4000-8000-000000000001'
) t
WHERE NOT EXISTS (
  SELECT 1 FROM templates x
   WHERE x.slug = 'template_2_followup_new_thread'
     AND x.org_id IS NOT DISTINCT FROM t.org_id
);
