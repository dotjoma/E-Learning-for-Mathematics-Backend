-- Add Google OAuth support to users table

-- Add google_id column to store Google user ID
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;

-- Create index for google_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- Allow password to be nullable for Google OAuth users
ALTER TABLE users 
ALTER COLUMN password DROP NOT NULL;

-- Add comment to document the change
COMMENT ON COLUMN users.google_id IS 'Google OAuth user ID (sub claim from Google JWT)';
COMMENT ON COLUMN users.password IS 'Password hash - can be empty for OAuth users';
