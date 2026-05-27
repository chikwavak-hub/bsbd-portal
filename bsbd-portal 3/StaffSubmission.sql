-- Run in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS staff_submissions (
  id           text PRIMARY KEY,
  date         text NOT NULL,
  office       text NOT NULL,
  username     text NOT NULL,
  staff_name   text NOT NULL,
  staff_role   text NOT NULL,
  data         jsonb NOT NULL DEFAULT '{}',
  submitted_at timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_sub_unique 
  ON staff_submissions(date, office, username);

ALTER TABLE staff_submissions DISABLE ROW LEVEL SECURITY;
