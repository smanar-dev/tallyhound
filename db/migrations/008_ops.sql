-- T-29 and T-91: what the people who run Tallyhound need to see, kept outside each firm's sealed state so it survives a restore.
-- Counts, times and outcomes only. Never a message, a document, a prompt or a client's name.
alter table usage_monthly add column segments_in integer not null default 0;
alter table usage_monthly add column mms integer not null default 0;
alter table usage_monthly add column texts_read integer not null default 0;
alter table usage_monthly add column written integer not null default 0;
alter table usage_monthly add column updated_at timestamptz;
-- One line per firm: when the timer last visited it and how today's sending went.
create table firm_status (
  firm_id     text primary key references firms(id) on delete cascade,
  last_tick   timestamptz,
  last_error  text,
  day         date,
  sent        integer not null default 0,
  failed      integer not null default 0
);
-- One row per call to the model.
create table model_calls (
  id             bigserial primary key,
  firm_id        text not null references firms(id) on delete cascade,
  at             timestamptz not null,
  model          text not null,
  tier           text not null,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  usd            numeric(10,6) not null default 0,
  ms             integer not null default 0,
  outcome        text not null            -- "ok", or the kind of failure: busy, network, refusal, cut_off, bad_json, cap ...
);
create index model_calls_firm_at on model_calls (firm_id, at);
