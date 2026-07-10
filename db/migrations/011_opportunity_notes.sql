-- Operator notes on an opportunity. Free-form scratchpad the operator can edit
-- anytime (call takeaways, reminders, strategy). The AI "tidy" action only
-- rewrites the text the operator submits and hands it back for review, it never
-- writes here on its own, so this column is always operator-owned.
alter table opportunities add column if not exists notes text;
