
BEGIN;

CREATE TABLE channels (
    channel_id   integer PRIMARY KEY,
    channel_code text NOT NULL UNIQUE,
    channel_name text NOT NULL
);

CREATE TABLE users (
    user_id       integer PRIMARY KEY,
    registered_at timestamptz NOT NULL,
    channel_id    integer NOT NULL REFERENCES channels (channel_id),
    platform      text NOT NULL CHECK (platform IN ('ios', 'android', 'web'))
);

CREATE TABLE ab_assignments (
    assignment_id   integer PRIMARY KEY,
    user_id         integer NOT NULL REFERENCES users (user_id),
    experiment_name text NOT NULL CHECK (experiment_name IN ('onboarding_v2', 'paywall_copy_v3')),
    variant         text NOT NULL CHECK (variant IN ('A', 'B')),
    assigned_at     timestamptz NOT NULL,
    UNIQUE (user_id, experiment_name)
);

CREATE TABLE events (
    event_id    bigint PRIMARY KEY,
    user_id     integer NOT NULL REFERENCES users (user_id),
    event_name  text NOT NULL CHECK (event_name IN (
        'registration',
        'onboarding_started',
        'onboarding_completed',
        'trial_started',
        'paywall_viewed'
    )),
    occurred_at timestamptz NOT NULL
);

CREATE TABLE payments (
    payment_id integer PRIMARY KEY,
    user_id    integer NOT NULL REFERENCES users (user_id),
    tariff     text NOT NULL CHECK (tariff IN ('monthly', 'annual')),
    amount_rub integer NOT NULL CHECK (amount_rub > 0),
    paid_at    timestamptz NOT NULL,
    status     text NOT NULL CHECK (status IN ('succeeded', 'refunded', 'failed'))
);

CREATE TABLE marketing_spend (
    spend_id    integer PRIMARY KEY,
    month       text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
    channel_id  integer NOT NULL REFERENCES channels (channel_id),
    spend_rub   integer NOT NULL CHECK (spend_rub >= 0),
    impressions integer NOT NULL CHECK (impressions >= 0),
    clicks      integer NOT NULL CHECK (clicks >= 0),
    UNIQUE (month, channel_id)
);

CREATE INDEX events_user_idx ON events (user_id, event_name);
CREATE INDEX events_name_idx ON events (event_name);
CREATE INDEX payments_user_idx ON payments (user_id);
CREATE INDEX payments_status_idx ON payments (status);
CREATE INDEX users_channel_idx ON users (channel_id);
CREATE INDEX users_registered_idx ON users (registered_at);
CREATE INDEX ab_assignments_experiment_idx ON ab_assignments (experiment_name);

COMMIT;
