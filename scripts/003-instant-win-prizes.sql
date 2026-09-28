-- Instant Win Prizes table for campaigns
-- Each prize has an unlock_ratio (0..1) threshold for pacing

CREATE TABLE IF NOT EXISTS instant_win_prizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  prize_title text NOT NULL,
  prize_value_text text NULL,
  unlock_ratio numeric NOT NULL CHECK (unlock_ratio >= 0 AND unlock_ratio <= 1),
  image_url text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- If table already exists, safely add missing columns
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'instant_win_prizes' AND column_name = 'image_url'
  ) THEN
    ALTER TABLE instant_win_prizes ADD COLUMN image_url text NULL;
  END IF;
END $$;

-- Index for fast lookups by campaign
CREATE INDEX IF NOT EXISTS idx_instant_win_prizes_campaign
  ON instant_win_prizes(campaign_id);

-- RLS
ALTER TABLE instant_win_prizes ENABLE ROW LEVEL SECURITY;

-- Public read
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'instant_win_prizes' AND policyname = 'instant_win_prizes_public_read'
  ) THEN
    CREATE POLICY instant_win_prizes_public_read ON instant_win_prizes
      FOR SELECT USING (true);
  END IF;
END $$;

-- Admin write (INSERT)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'instant_win_prizes' AND policyname = 'instant_win_prizes_admin_insert'
  ) THEN
    CREATE POLICY instant_win_prizes_admin_insert ON instant_win_prizes
      FOR INSERT WITH CHECK (public.is_admin_user());
  END IF;
END $$;

-- Admin write (UPDATE)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'instant_win_prizes' AND policyname = 'instant_win_prizes_admin_update'
  ) THEN
    CREATE POLICY instant_win_prizes_admin_update ON instant_win_prizes
      FOR UPDATE USING (public.is_admin_user());
  END IF;
END $$;

-- Admin write (DELETE)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'instant_win_prizes' AND policyname = 'instant_win_prizes_admin_delete'
  ) THEN
    CREATE POLICY instant_win_prizes_admin_delete ON instant_win_prizes
      FOR DELETE USING (public.is_admin_user());
  END IF;
END $$;
