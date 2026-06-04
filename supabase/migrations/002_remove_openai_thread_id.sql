-- Remove OpenAI Responses API column (no longer used)
ALTER TABLE threads DROP COLUMN IF EXISTS openai_thread_id;
