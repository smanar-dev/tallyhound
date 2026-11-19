-- Each firm's short public name, letters only. It is the first half of every client link (go.../u/<slug>-<client key>)
-- and the address of the firm's public page. It says which firm, and nothing about any client.
alter table firms add column slug text unique;
