-- TH-BRK-10: a member of staff may add their own mobile to be texted when the review queue needs them. It is verified with a code
-- before anything is sent to it, and texts come from Tallyhound's own number, never the firm's client number. Only a hash of the
-- code is kept, for ten minutes.
alter table users add column mobile text;
alter table users add column mobile_verified_at timestamptz;
alter table users add column mobile_code text;
alter table users add column mobile_code_until timestamptz;
create index users_mobile on users (mobile) where mobile is not null;
