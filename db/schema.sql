-- Tallyhound: Postgres schema. Run once on an empty database.
--
-- What lives here and what does not
--   * Firm working state (clients, checklists, messages, document records) is one sealed value per firm in firm_state.
--     It is encrypted by the application with that firm's own key before it reaches this database (packages/core/crypto.js),
--     so a database backup on its own shows names of tables and sizes of rows, and no client data.
--   * Document files live in object storage, sealed the same way. This database holds only where they are (files).
--   * The audit log is a separate append-only table: the application role can add rows and read them, never change or remove them.
--   * No Social Security number, bank number, date of birth or return figure has a column anywhere. There is nowhere to put one.
--
-- Scale note (tools/scale.js): one sealed value per firm is comfortable to about 500 clients. Before the Large plan is sold,
-- messages and the audit log move to their own rows (ticket T-101); the tables for that are at the bottom, unused until then.

create table firms (
  id            text primary key,
  name          text not null,
  inbox         text unique,                 -- the firm's Tallyhound address, lower case
  sms_number    text unique,                 -- ten digits
  wrapped_key   bytea,                       -- the firm's data key, encrypted by the master key held in the key service. Null = account destroyed
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  destroyed_at  timestamptz
);

create table firm_state (
  firm_id     text primary key references firms(id) on delete cascade,
  sealed      text not null,                 -- base64( "th1" | nonce | tag | AES-256-GCM( gzip( json ) ) ), label "state:<firm_id>"
  version     bigint not null default 1,     -- goes up by one on every save; a save against an old version is refused
  bytes       integer not null default 0,
  updated_at  timestamptz not null default now()
);

create table files (
  key           text primary key,            -- "<firm_id>/<random>", also the object-storage key
  firm_id       text not null references firms(id) on delete cascade,
  content_type  text not null,
  bytes         integer not null,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz                  -- set when the object is removed; the row stays as proof of deletion, with no content
);
create index files_firm on files (firm_id) where deleted_at is null;

-- Every webhook delivery, once. A provider that retries gets the same answer and nothing is processed twice.
create table inbound_events (
  provider     text not null,
  provider_id  text not null,
  firm_id      text references firms(id) on delete cascade,
  received_at  timestamptz not null default now(),
  primary key (provider, provider_id)
);

create table audit_log (
  id       bigserial primary key,
  firm_id  text not null,                    -- no foreign key on purpose: the log outlives the firm row
  at       timestamptz not null default now(),
  actor    text not null,
  action   text not null,
  detail   text                              -- sealed with the firm key when it could name a client
);
create index audit_firm_at on audit_log (firm_id, at desc);

-- Counters for billing and fair use. Numbers only.
create table usage_monthly (
  firm_id  text not null references firms(id) on delete cascade,
  month    date not null,
  segments integer not null default 0,
  emails   integer not null default 0,
  docs     integer not null default 0,
  primary key (firm_id, month)
);

-- Staff sign-in. Passwords are never stored: sign-in is by emailed link or an identity provider, plus a second factor.
create table users (
  id          text primary key,
  firm_id     text not null references firms(id) on delete cascade,
  email       text not null unique,
  role        text not null check (role in ('owner', 'staff', 'read_only')),
  mfa_secret  bytea,                         -- sealed with the firm's data key (see db/migrations/002_signin.sql)
  last_seen   timestamptz
);
create table sessions (
  token_hash  bytea primary key,             -- SHA-256 of the session token; the token itself is only ever in the browser cookie
  user_id     text not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  ip          inet
);

-- The application connects as tallyhound_app. It cannot rewrite history.
-- create role tallyhound_app login;
-- grant select, insert, update, delete on firms, firm_state, files, inbound_events, usage_monthly, users, sessions to tallyhound_app;
-- grant select, insert on audit_log to tallyhound_app;
-- grant usage on sequence audit_log_id_seq to tallyhound_app;

-- ---------------------------------------------------------------------------------------------------------------------
-- Target layout for firms over about 500 clients (T-101). Not used by the code yet.
-- Messages and documents become rows so that one inbound text reads and writes kilobytes, not megabytes.
-- create table messages  (id text primary key, firm_id text not null, engagement_id text not null, at timestamptz not null, sealed bytea not null);
-- create table documents (id text primary key, firm_id text not null, engagement_id text, state text not null, file_key text, at timestamptz not null, delivered_at timestamptz, stripped_at timestamptz, sealed bytea);
-- create index messages_eng on messages (firm_id, engagement_id, at);
-- create index documents_due on documents (firm_id, delivered_at) where stripped_at is null;
