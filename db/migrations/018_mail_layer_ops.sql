-- v2: what Tallyhound needs if Neeter cannot call us or cannot make an assistant from our sign-in (docs/neeter/RUNBOOK.md).
-- poll_cursor: where the timer got to in an assistant's events. linked: the assistant was set up at the layer another way and
-- Tallyhound holds no token for it.
alter table mailbox_connection add column if not exists poll_cursor text;
alter table mailbox_connection add column if not exists linked boolean not null default false;
