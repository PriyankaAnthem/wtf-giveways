-- Add is_high_value boolean column to instant_win_prizes table
-- This allows operators to mark certain prizes as high value for special distribution logic

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'instant_win_prizes' AND column_name = 'is_high_value'
  ) THEN
    ALTER TABLE instant_win_prizes ADD COLUMN is_high_value boolean NOT NULL DEFAULT false;
  END IF;
END $$;
