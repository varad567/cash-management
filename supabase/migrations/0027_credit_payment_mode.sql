-- Commit this migration before 0028: PostgreSQL cannot use a new enum
-- value in the transaction which adds it.
alter type payment_mode add value if not exists 'credit';
