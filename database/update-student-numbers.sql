-- Migration: Update student numbers to sequential format
-- Run this after updating the schema

-- Add student_sequence column if it doesn't exist
ALTER TABLE students ADD COLUMN IF NOT EXISTS student_sequence INTEGER UNIQUE;

-- Create sequence for student numbers
CREATE SEQUENCE IF NOT EXISTS student_number_seq START WITH 1;

-- Create function to get next student number
CREATE OR REPLACE FUNCTION get_next_student_number()
RETURNS INTEGER AS $$
DECLARE
  next_num INTEGER;
BEGIN
  next_num := nextval('student_number_seq');
  RETURN next_num;
END;
$$ LANGUAGE plpgsql;

-- Update existing students with sequential numbers
-- This will assign numbers based on creation order
DO $$
DECLARE
  student_record RECORD;
  counter INTEGER := 1;
BEGIN
  FOR student_record IN 
    SELECT id FROM students ORDER BY created_at ASC
  LOOP
    UPDATE students 
    SET 
      student_sequence = counter,
      student_number = 'STU-' || LPAD(counter::TEXT, 4, '0')
    WHERE id = student_record.id;
    
    counter := counter + 1;
  END LOOP;
  
  -- Set sequence to continue from last number
  PERFORM setval('student_number_seq', counter);
END $$;

-- Verify the update
SELECT id, student_number, student_sequence, created_at 
FROM students 
ORDER BY student_sequence;
