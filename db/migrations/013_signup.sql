-- T-79: a firm signs itself up. Nothing is created until the email address has been confirmed; until then the request waits here
-- for an hour and is then removed. Only a hash of the confirmation token is kept.
create table signup_requests (
  token_hash  text primary key,
  email       text not null,
  payload     jsonb not null,
  created_at  timestamptz not null,
  expires_at  timestamptz not null
);
create index signup_requests_email on signup_requests (email, created_at);
