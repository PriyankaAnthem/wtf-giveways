-- ============================================================================
-- WTF Marketing Hub — Stage 0 patch 002: strictly idempotent preference writes
-- ----------------------------------------------------------------------------
-- PURPOSE
--   Redefine ONLY public.set_marketing_email_preference so that repeated calls
--   that do not change the effective state become true no-ops:
--
--     * Repeated ENABLE with the same active state, source AND consent version
--       must NOT reset consented_at and must NOT append another event.
--     * Repeated DISABLE while already disabled WITH an active 'unsubscribe'
--       suppression must NOT reset unsubscribed_at and must NOT append another
--       event.
--     * A genuine state transition still updates the preference row, the
--       suppression row and the audit log EXACTLY ONCE.
--     * Re-enabling revokes ONLY active 'unsubscribe' suppressions. It never
--       revokes 'hard_bounce', 'complaint', 'manual' or 'invalid_address'.
--
-- SAFETY / SCOPE
--   * ADDITIVE and idempotent to APPLY. It only runs CREATE OR REPLACE FUNCTION
--     plus REVOKE/GRANT, so re-running it is a no-op. It creates no tables and
--     alters no data.
--   * It does NOT modify migration 001, and it does NOT rename or drop any live
--     table or function. marketing_can_reenable, is_marketing_email_eligible,
--     unsubscribe_marketing_email and every table name are left untouched.
--   * unsubscribe_marketing_email is unchanged: it already delegates to
--     set_marketing_email_preference(..., false, ...), so it inherits the new
--     idempotent behaviour automatically.
--   * The function signature is identical to 001, so CREATE OR REPLACE keeps the
--     existing EXECUTE grant; the REVOKE/GRANT block at the end simply re-asserts
--     the service_role-only contract.
--
-- HOW TO RUN
--   The application NEVER executes this. Run it manually once in the Supabase
--   SQL editor (or psql) against the project database, AFTER migration 001.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- set_marketing_email_preference (idempotent): enable or disable marketing for
-- one user. Same signature and same end-states as 001 — only the "no real
-- change" fast-paths and the single-write guarantee are new.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_marketing_email_preference(
  p_user_id         uuid,
  p_email_lc        text,
  p_enabled         boolean,
  p_source          text,
  p_consent_version text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email        text := btrim(lower(coalesce(p_email_lc, '')));
  v_have_pref    boolean := false;
  v_cur_enabled  boolean;
  v_cur_source   text;
  v_cur_version  text;
  v_active_unsub boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;
  IF v_email = '' THEN
    RAISE EXCEPTION 'p_email_lc is required';
  END IF;
  IF coalesce(p_source, '') = '' THEN
    RAISE EXCEPTION 'p_source is required';
  END IF;

  -- Serialise concurrent calls for the SAME user so two racing repeats cannot
  -- both slip past the no-op checks and double-write. Transaction-scoped, so it
  -- is released automatically when this function's implicit transaction ends.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- Snapshot the current preference (locking the row when it exists) so the
  -- decision below and any subsequent write are consistent.
  SELECT mp.email_marketing_enabled, mp.consent_source, mp.consent_version
    INTO v_cur_enabled, v_cur_source, v_cur_version
    FROM public.marketing_preferences mp
   WHERE mp.user_id = p_user_id
   FOR UPDATE;
  v_have_pref := FOUND;

  -- Is there an ACTIVE 'unsubscribe' suppression for this email or user? Only
  -- 'unsubscribe' is considered here — other reasons never participate in the
  -- enable/disable idempotency decision (and are never revoked by enabling).
  SELECT EXISTS (
    SELECT 1 FROM public.marketing_suppressions
     WHERE revoked_at IS NULL
       AND reason = 'unsubscribe'
       AND (email_lc = v_email OR user_id = p_user_id)
  ) INTO v_active_unsub;

  IF p_enabled THEN
    IF coalesce(p_consent_version, '') = '' THEN
      RAISE EXCEPTION 'p_consent_version is required when enabling';
    END IF;

    -- No-op fast path: already enabled with the SAME source and consent version
    -- and nothing to revoke. Do not touch consented_at and do not log an event.
    IF v_have_pref
       AND v_cur_enabled IS TRUE
       AND v_cur_source   IS NOT DISTINCT FROM p_source
       AND v_cur_version  IS NOT DISTINCT FROM p_consent_version
       AND NOT v_active_unsub
    THEN
      RETURN;
    END IF;

    -- Genuine transition (first enable, changed source/version, was disabled,
    -- or a lingering unsubscribe needs lifting): write preference exactly once.
    INSERT INTO public.marketing_preferences AS mp (
      user_id, email_marketing_enabled, consented_at, consent_source,
      consent_version, unsubscribed_at, updated_at
    )
    VALUES (p_user_id, true, now(), p_source, p_consent_version, NULL, now())
    ON CONFLICT (user_id) DO UPDATE SET
      email_marketing_enabled = true,
      consented_at            = now(),
      consent_source          = excluded.consent_source,
      consent_version         = excluded.consent_version,
      unsubscribed_at         = NULL,
      updated_at              = now();

    -- Re-enabling only lifts a prior *unsubscribe*. Bounce / complaint / manual
    -- / invalid-address suppressions remain active and keep blocking sending.
    IF v_active_unsub THEN
      UPDATE public.marketing_suppressions
         SET revoked_at = now()
       WHERE revoked_at IS NULL
         AND reason = 'unsubscribe'
         AND (email_lc = v_email OR user_id = p_user_id);
    END IF;

    INSERT INTO public.marketing_preference_events (user_id, event_type, source, consent_version)
    VALUES (p_user_id, 'subscribed', p_source, p_consent_version);

  ELSE
    -- No-op fast path: already disabled AND already covered by an active
    -- unsubscribe suppression. Do not touch unsubscribed_at and do not log.
    IF v_have_pref
       AND v_cur_enabled IS FALSE
       AND v_active_unsub
    THEN
      RETURN;
    END IF;

    -- Genuine transition (was enabled, or disabled but missing its unsubscribe
    -- suppression): write preference exactly once.
    INSERT INTO public.marketing_preferences AS mp (
      user_id, email_marketing_enabled, unsubscribed_at, consent_source, updated_at
    )
    VALUES (p_user_id, false, now(), p_source, now())
    ON CONFLICT (user_id) DO UPDATE SET
      email_marketing_enabled = false,
      unsubscribed_at         = now(),
      updated_at              = now();

    -- Add an active unsubscribe suppression only if one is not already active
    -- (guarded both by this check and the partial unique index in 001).
    IF NOT v_active_unsub THEN
      INSERT INTO public.marketing_suppressions (user_id, email_lc, reason, source)
      SELECT p_user_id, v_email, 'unsubscribe', p_source
      WHERE NOT EXISTS (
        SELECT 1 FROM public.marketing_suppressions
         WHERE revoked_at IS NULL AND reason = 'unsubscribe' AND email_lc = v_email
      );
    END IF;

    INSERT INTO public.marketing_preference_events (user_id, event_type, source)
    VALUES (p_user_id, 'unsubscribed', p_source);
  END IF;
END;
$$;

-- Re-assert the service_role-only contract (CREATE OR REPLACE preserves grants;
-- this is belt-and-braces and safe to re-run).
REVOKE ALL ON FUNCTION public.set_marketing_email_preference(uuid, text, boolean, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_marketing_email_preference(uuid, text, boolean, text, text) TO service_role;

-- ============================================================================
-- End of patch 002. No table/function was renamed or dropped; no data changed;
-- no email is sent and no sending capability is added.
-- ============================================================================
