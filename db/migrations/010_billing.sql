-- T-81: card billing through Stripe. Tallyhound holds no card details: only Stripe's ids for the firm's customer and subscription,
-- which plan it is, and when a payment first failed. Pricing is flat by plan (docs/PRICING.md): nothing here counts usage.
create table firm_billing (
  firm_id          text primary key references firms(id) on delete cascade,
  customer_id      text not null,
  subscription_id  text,
  plan             text,
  status           text not null default 'active',     -- active, past_due, cancelled, ended
  past_due_since   timestamptz,                        -- the first failed payment not yet made good
  paused           boolean not null default false,     -- whether Stripe has been told to stop collecting for a pause
  updated_at       timestamptz not null
);
create unique index firm_billing_customer on firm_billing (customer_id);
-- Every webhook event is handled once.
create table stripe_events (
  id  text primary key,
  at  timestamptz not null
);
