/** Only the exact shipped legacy default is adapted; custom copy is never rewritten. */
export const LEGACY_INITIAL_OUTREACH_BODY = [
      "Hi {{owner_name}},",
      "",
      "I'm {{sender_name}} with {{company_name}}. We're preparing a bid for {{trade}} work in {{location_city_state}} and would like your pricing for the scope below.",
      "",
      "Please review the complete scope, requirements, and attached bid documents. If your team can perform the complete trade scope, reply by {{quote_due_date}} with your price, availability, payment terms, and exclusions.",
      "",
      'If you can perform only part of the scope, please explain exactly what you can and cannot provide. If you\'re not interested, a quick "pass" is helpful. If someone else handles estimates, please point me in the right direction.',
      "",
      "Thanks,",
      "{{sender_name}}",
      "{{company_name}}",
      "{{phone}}",
    ].join("\n");

export const INITIAL_OUTREACH_BODY = [
  "Hi {{owner_name}},", "",
  "I'm {{sender_name}} with {{company_name}}. We're preparing a bid for the project below.",
  "", "Thanks,", "{{sender_name}}", "{{company_name}}", "{{phone}}",
].join("\n");

export function currentInitialOutreachBody(body:string):string {
  return body.replace(/\r\n/g,"\n").trim() === LEGACY_INITIAL_OUTREACH_BODY.trim()
    ? INITIAL_OUTREACH_BODY : body;
}
