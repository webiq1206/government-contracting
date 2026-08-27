/**
 * The conversation a message belongs to.
 *
 * Exported because the opportunity's subcontractor rows offer a link straight
 * to the thread, and the key that link uses has to be the key the inbox groups
 * by. Two derivations of the same key is a link that lands on an empty pane.
 *
 * The Gmail thread id when we have one. Messages logged before threading, or
 * without a thread, group by solicitation and subcontractor so history still
 * reads as conversations rather than as one conversation per message.
 */
export const THREAD_KEY_SQL = `coalesce(
  c.gmail_thread_id,
  case
    /*
     * A message with neither a subcontractor nor a solicitation stands alone.
     * Falling back to a shared 'none:none' key would merge every orphaned
     * message in the account into one conversation and show it under whichever
     * company happened to send the newest of them, which is worse than showing
     * them separately: it attributes one company's mail to another.
     */
    when c.subcontractor_id is null and c.opportunity_id is null then 'msg:' || c.id::text
    else 'pair:' || coalesce(c.opportunity_id::text, 'none') || ':' || coalesce(c.subcontractor_id::text, 'none')
  end
)`;
