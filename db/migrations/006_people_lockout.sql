-- T-146: a person who leaves is switched off, not deleted, so their name stays on the firm's history.
-- T-144: five wrong codes in 15 minutes lock sign-in for that person for 15 minutes.
alter table users add column left_at timestamptz;
alter table users add column locked_until timestamptz;
create table signin_fails (
  user_id  text not null references users(id) on delete cascade,
  at       timestamptz not null
);
create index signin_fails_user on signin_fails (user_id, at);
