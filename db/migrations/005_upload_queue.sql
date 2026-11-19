-- Files sent from a client's upload page go through the same queue as texts and email: stored, answered, then read.
alter table inbound_queue drop constraint inbound_queue_kind_check;
alter table inbound_queue add constraint inbound_queue_kind_check check (kind in ('sms', 'email', 'upload'));
