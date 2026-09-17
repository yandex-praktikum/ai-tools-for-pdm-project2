
BEGIN;

TRUNCATE TABLE
    payments,
    events,
    ab_assignments,
    users,
    marketing_spend,
    channels
RESTART IDENTITY CASCADE;

COMMIT;
