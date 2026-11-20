-- T-111: a firm's connection to its own storage (Google Drive). The long-lived token is sealed with the firm's own key
-- (label "storage:<provider>"), so it dies with the key when the firm closes its account.
create table firm_storage (
  firm_id       text primary key references firms(id) on delete cascade,
  provider      text not null,
  sealed_token  bytea not null,
  connected_at  timestamptz not null,
  connected_by  text not null
);
