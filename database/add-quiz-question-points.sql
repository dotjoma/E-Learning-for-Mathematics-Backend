-- Add points column to quiz_questions table
ALTER TABLE quiz_questions 
ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 1;

-- Update existing questions to have default 1 point
UPDATE quiz_questions 
SET points = 1 
WHERE points IS NULL;

-- Add total_points column to quizzes table if not exists
ALTER TABLE quizzes 
ADD COLUMN IF NOT EXISTS total_points INTEGER DEFAULT 0;

-- Update total_points for existing quizzes
UPDATE quizzes q
SET total_points = (
  SELECT COALESCE(SUM(points), 0)
  FROM quiz_questions qq
  WHERE qq.quiz_id = q.id
);
