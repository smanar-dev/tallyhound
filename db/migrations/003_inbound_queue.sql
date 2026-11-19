-- The inbound queue (T-128). A webhook stores the event and answers at once; a worker reads and replies, with retries.
-- The event itself (message text, attachments) is NOT in this table: it is sealed with the firm's key and kept with the
-- firm's files. This table holds only where it is and how the work is going.
create table inbound_queue (
  id           bigserial primary key,
  provider     text not null,                -- 'twilio' or 'postmark'
  provider_id  text not null,                -- the provider's own message id: a repeated delivery is stored once
  firm_id      text not null references firms(id) on delete cascade,
  kind         text not null check (kind in ('sms', 'email')),
  file_key     text,                         -- the sealed event in the firm's file store; null once it has been deleted
  state        text not null default 'ready' check (state in ('ready', 'working', 'done', 'dead')),
  attempts     integer not null default 0,
  next_at      timestamptz not null default now(),
  locked_at    timestamptz,
  last_error   text,                         -- an error message from our own code; never message content
  created_at   timestamptz not null default now(),
  finished_at  timestamptz,
  unique (provider, provider_id)
);
create index inbound_queue_due on inbound_queue (next_at) where state in ('ready', 'working');
