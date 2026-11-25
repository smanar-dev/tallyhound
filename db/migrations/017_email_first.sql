-- Tallyhound v2, email-first (docs/V2.md section 8).
-- One connected mailbox per staff user. The long-lived token is sealed with the firm's key. assistant_id is the mail layer's own
-- id for that mailbox: it is used on the server only and is never sent to a browser.
create table if not exists mailbox_connection (
  firm_id       text not null references firms(id) on delete cascade,
  user_id       text not null,
  provider      text not null check (provider in ('google', 'microsoft')),
  address       text not null,
  scopes        text[] not null default '{}',
  status        text not null default 'active' check (status in ('active', 'revoked', 'error')),
  assistant_id  text,
  sealed_token  bytea,
  connected_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  primary key (firm_id, user_id)
);
create unique index if not exists mailbox_connection_address on mailbox_connection (firm_id, address) where status = 'active';
create index if not exists mailbox_connection_assistant on mailbox_connection (assistant_id) where status = 'active';

-- One key per firm for the mail layer, sealed with the firm's key, replaced every 90 days (TH-NTR-9).
create table if not exists mail_layer_key (
  firm_id    text primary key references firms(id) on delete cascade,
  sealed_key bytea not null,
  issued_at  timestamptz not null default now()
);

-- The spec's neeter_link, neeter_outbox and upload_link tables are not made. Those records live inside each firm's sealed state
-- (the engagement's mirror and link), so they are saved in the same write as the change that caused them and are never in the
-- database in the clear. See docs/V2.md, "Where the build differs".
