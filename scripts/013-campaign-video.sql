-- =============================================================================
-- 013 - Campaign promotional video (Video Phase 1 MVP)
-- =============================================================================
-- ADDITIVE ONLY. Introduces an OPTIONAL short promotional video per campaign.
-- The primary campaign artwork (campaigns.hero_image_url) remains REQUIRED and
-- continues to serve as the Featured Hero LCP image, the video poster, the
-- loading/failure/reduced-motion fallback, and the card/listing image. Video
-- is a pure enhancement layered over the artwork after playback is ready.
--
-- WHAT THIS MIGRATION DOES
--   1. Adds two nullable columns to public.campaigns:
--        promo_video_url        text    null  -- public URL in campaign-video
--        promo_video_duration_s integer null  -- measured client-side on upload
--   2. Creates ONE new dedicated PUBLIC storage bucket `campaign-video` with:
--        * public read
--        * admin-only insert / update / delete (admin_role() = 'admin')
--        * video/mp4 ONLY
--        * 4 MB hard file-size limit
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * It does NOT add a poster column — hero_image_url IS the poster/fallback.
--   * It does NOT add provider id / processing / transcoding / rendition /
--     separate desktop-mobile / portrait columns. Those belong to a future
--     provider architecture ONLY if ever needed (Phase 2+).
--   * It does NOT touch the existing campaign-hero / instant-win-prizes /
--     big-wins buckets or their policies.
--   * It does NOT alter giveaway_snapshots: snapshots store a JSONB `payload`,
--     so the video fields ride inside the existing payload with no DDL.
--
-- MIGRATION SAFETY / DEPLOY ORDER
--   Fully additive and idempotent (safe to re-run). Existing campaigns get
--   promo_video_url = NULL and therefore behave EXACTLY as today. The columns
--   and bucket may exist before the application code ships; the code also
--   tolerates the columns being absent, so either deploy order is safe.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Additive nullable columns on campaigns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS promo_video_url text NULL;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS promo_video_duration_s integer NULL;

-- Guard: duration, when present, must be a sane positive value within the
-- Phase 1 hard maximum (15s). NULL is always allowed (image-only campaign).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_promo_video_duration_range'
  ) THEN
    ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_promo_video_duration_range
      CHECK (promo_video_duration_s IS NULL OR (promo_video_duration_s > 0 AND promo_video_duration_s <= 15));
  END IF;
END $$;

COMMENT ON COLUMN public.campaigns.promo_video_url IS
  'Optional public URL of a short promotional MP4 in the campaign-video bucket. NULL = image-only campaign (unchanged behaviour). hero_image_url remains the required poster/fallback.';
COMMENT ON COLUMN public.campaigns.promo_video_duration_s IS
  'Optional measured duration (seconds) of promo_video_url, captured client-side at upload. NULL when there is no video.';

-- ---------------------------------------------------------------------------
-- 2. Dedicated PUBLIC bucket for promo videos.
--    public read + admin-only write, mirroring the campaign-hero / big-wins
--    security model, PLUS a hard 4 MB size cap and video/mp4-only MIME guard
--    enforced by Storage itself (defence-in-depth on top of client validation).
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('campaign-video', 'campaign-video', true, 4194304, ARRAY['video/mp4'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 4194304,
      allowed_mime_types = ARRAY['video/mp4'];

DROP POLICY IF EXISTS campaign_video_public_read ON storage.objects;
CREATE POLICY campaign_video_public_read
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'campaign-video');

DROP POLICY IF EXISTS campaign_video_admin_insert ON storage.objects;
CREATE POLICY campaign_video_admin_insert
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'campaign-video' AND admin_role() = 'admin');

DROP POLICY IF EXISTS campaign_video_admin_update ON storage.objects;
CREATE POLICY campaign_video_admin_update
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'campaign-video' AND admin_role() = 'admin')
  WITH CHECK (bucket_id = 'campaign-video' AND admin_role() = 'admin');

DROP POLICY IF EXISTS campaign_video_admin_delete ON storage.objects;
CREATE POLICY campaign_video_admin_delete
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'campaign-video' AND admin_role() = 'admin');

COMMIT;
