-- T-108: things still to be removed at Twilio after a first try failed: a picture, or the words of a text. Ids only, never content.
create table twilio_cleanup (
  id     bigserial primary key,
  kind   text not null check (kind in ('media', 'body')),
  ref    text not null,            -- the picture's address at Twilio, or the message id
  at     timestamptz not null,
  tries  integer not null default 0,
  unique (kind, ref)
);
-- T-107: support access. A person at Tallyhound, let in by a firm's owner to look and not change, until a set time.
alter table users add column support_until timestamptz;
