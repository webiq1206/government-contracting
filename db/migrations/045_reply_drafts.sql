-- Suggested replies to subcontractor emails, written on request.
--
-- Kept rather than regenerated because generating one costs money. An operator
-- who opens a thread, reads the draft, gets pulled away, and comes back should
-- find their draft where they left it and should not pay for it twice.
--
-- Keyed to the inbound message rather than to the conversation: a conversation
-- has no stable id (it is a Gmail thread when we have one and a synthetic key
-- when we do not), while the message being answered is a real row. One draft
-- per inbound message also gives the right behaviour for free when a second
-- reply arrives: it is a different message, so it gets its own draft instead
-- of silently inheriting the answer to the previous one.

create table if not exists reply_drafts (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid references organizations(id) on delete cascade,
  -- The inbound message this answers. Unique: regenerating replaces.
  communication_id  uuid not null unique
                      references communications(id) on delete cascade,
  subcontractor_id  uuid references subcontractors(id) on delete set null,
  opportunity_id    uuid references opportunities(id) on delete set null,
  -- What the model wrote, kept unchanged so a regeneration can be compared
  -- against what the operator has since done to it.
  generated_body    text not null,
  -- What the operator has typed over it. Null until they touch it, which is
  -- what lets the UI tell "not yet edited" from "deliberately cleared".
  edited_body       text,
  -- Rules the draft was told to follow but appears to break. Shown to the
  -- operator; never a reason to hide the draft, because a person sends it.
  warnings          text[] not null default '{}',
  model             text,
  generated_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists reply_drafts_sub_idx
  on reply_drafts (subcontractor_id);
