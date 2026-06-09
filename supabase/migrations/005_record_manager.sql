ALTER TABLE documents ADD COLUMN content_hash text;
ALTER TABLE chunks ADD COLUMN content_hash text;
CREATE INDEX chunks_content_hash_idx ON chunks(content_hash);
