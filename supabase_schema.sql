-- Copy and execute this in the Supabase SQL Editor

CREATE TABLE container_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "containerSelection" TEXT NOT NULL,
  packlist JSONB NOT NULL
);

-- Turn on row-level security if desired (optional)
-- ALTER TABLE container_projects ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Allow public access for dev" ON container_projects FOR ALL USING (true);
