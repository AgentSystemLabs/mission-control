-- Rename legacy task statuses to the new vocabulary.
--   idle, done -> finished
--   failed     -> terminated
UPDATE tasks SET status = 'finished'   WHERE status IN ('idle', 'done');
UPDATE tasks SET status = 'terminated' WHERE status = 'failed';
