-- T-33, T-54, T-101: a firm is no longer saved as one value.
-- firm_state keeps the core (settings, people, counters). Each client's working data is one sealed row in firm_parts, so a text
-- from one client reads and rewrites that client's row and the core, not the whole firm. The firm's audit trail is rows that are
-- only ever added. A firm saved the old way is split the first time it is next saved; nothing needs to be run by hand.
create table firm_parts (
  firm_id     text not null references firms(id) on delete cascade,
  key         text not null,               -- "c:<client id>"
  sealed      text not null,               -- base64( sealed( gzip( json ) ) ), label "part:<firm_id>:<key>"
  bytes       integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (firm_id, key)
);
-- How an inbound text or email finds its client's row without opening every row: a keyed hash of the mobile number or the
-- email address, made with the firm's own data key. The number and the address themselves are never stored here.
create table firm_index (
  firm_id  text not null references firms(id) on delete cascade,
  hash     text not null,
  part     text not null,
  primary key (firm_id, hash, part)
);
create index firm_index_part on firm_index (firm_id, part);
-- The firm's own audit trail (what staff and Tallyhound did, shown to the owner). One sealed row per save, newest last.
create table firm_audit (
  id       bigserial primary key,
  firm_id  text not null references firms(id) on delete cascade,
  at       timestamptz not null default now(),
  lines    integer not null,
  sealed   text not null                   -- label "part:<firm_id>:audit"
);
create index firm_audit_firm on firm_audit (firm_id, id);
