-- Storage services that need to remember where to file (a SharePoint site's document library). Ids only.
alter table firm_storage add column config jsonb;
