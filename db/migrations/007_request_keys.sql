-- T-147: a staff action that is sent twice (a retry after a lost answer) runs once. The key is claimed before the action runs.
create table request_keys (
  firm_id   text not null references firms(id) on delete cascade,
  key       text not null,
  at        timestamptz not null,
  response  jsonb,            -- null until the action has finished; holds ids and outcomes, never a message or a document
  primary key (firm_id, key)
);
create index request_keys_at on request_keys (at);
