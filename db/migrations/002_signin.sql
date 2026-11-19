-- Sign-in, round 16. Adds what packages/core/auth.js needs to the users and sessions tables in schema.sql.
-- The second-factor secret is sealed with the firm's own data key (label "mfa:<user id>"), so it dies with the firm's key.
alter table users add column name text not null default '';
alter table users add column mfa_pending bytea;                  -- a secret shown at setup and not yet confirmed with a code
alter table users add column totp_step bigint;                   -- the last accepted code's time step: a code is never accepted twice
alter table users add column created_at timestamptz not null default now();
create index users_firm on users (firm_id);

alter table sessions add column stage text not null default 'link' check (stage in ('link', 'full'));   -- 'link': the emailed link was opened, the code is still owed
alter table sessions add column fails integer not null default 0;
create index sessions_user on sessions (user_id);

-- Ten one-time recovery codes per user. Only hashes are stored.
create table recovery_codes (
  user_id  text not null references users(id) on delete cascade,
  hash     text not null,
  used_at  timestamptz,
  primary key (user_id, hash)
);
-- Every emailed link works once.
create table signin_links (
  jti         text primary key,
  expires_at  timestamptz not null
);
-- One row per link requested, for the rate limit. Holds a hash of the address, not the address.
create table signin_requests (
  email_hash  text not null,
  at          timestamptz not null default now()
);
create index signin_requests_email on signin_requests (email_hash, at);
