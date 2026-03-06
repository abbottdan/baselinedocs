-- Migration: Add unique constraint on user_notification_preferences.user_id
--
-- The upsert in /api/settings/notifications requires a unique constraint
-- to resolve ON CONFLICT. Each user has exactly one preferences row,
-- so user_id alone is the correct conflict target.

ALTER TABLE user_notification_preferences
  ADD CONSTRAINT user_notification_preferences_user_id_key UNIQUE (user_id);
