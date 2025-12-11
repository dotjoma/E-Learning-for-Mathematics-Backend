-- Migration: Add lesson_completions table
-- Run this in your Supabase SQL Editor

-- Lesson completions table (track student lesson completions)
CREATE TABLE IF NOT EXISTS lesson_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  stars INTEGER DEFAULT 0 CHECK (stars >= 0 AND stars <= 3),
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(student_id, lesson_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_lesson_completions_student_id ON lesson_completions(student_id);
CREATE INDEX IF NOT EXISTS idx_lesson_completions_lesson_id ON lesson_completions(lesson_id);

-- Enable Row Level Security (RLS)
ALTER TABLE lesson_completions ENABLE ROW LEVEL SECURITY;

-- RLS Policy - Lesson completions are readable
CREATE POLICY "Lesson completions are readable" ON lesson_completions
  FOR SELECT USING (true);

-- RLS Policy - Students can insert their own completions
CREATE POLICY "Students can insert own completions" ON lesson_completions
  FOR INSERT WITH CHECK (true);

-- RLS Policy - Students can update their own completions
CREATE POLICY "Students can update own completions" ON lesson_completions
  FOR UPDATE USING (true);
