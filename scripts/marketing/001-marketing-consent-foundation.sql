-- ============================================================================
-- WTF Marketing Hub — Stage 0: consent, suppression & unsubscribe foundation
-- ----------------------------------------------------------------------------
-- PURPOSE
--   Create the permission + suppression foundation that can answer one
--   question for FUTURE marketing jobs:
--
--       May this user receive a marketing email?
--
--   The answer defaults to NO. It is only YES when the user has an ENABLED
--   marketing preference AND there is no active suppression for their email or
--   user id.
--
-- SAFETY / SCOPE
--   * This script is ADDITIVE and safe to run ONCE. Every object uses
--     IF NOT EXISTS so a re-run is a no-op.
--   * It does NOT touch auth.users, checkout_intents, entries,
--     ticket_allocations, instant_win_awards, wallet, user_preferences or any
--     customer-facing path. No triggers are added to any existing table.
--   * It does NOT backfill the 8,916 auth users, the 7,945 confirmed buyers,
--     or the 443 pre_registrations rows. A preference row only ever exists
--     because the customer actively set it. Absence of a row = unknown =
--     INELIGIBLE.
--   * It does NOT send email and creates no sending capability.
--
-- HOW TO RUN
--   The application NEVER executes this. Run it manually once in the Supabase
--   SQL editor (or psql) against the project database.
--
-- SECURITY MODEL
--   All three tables have RLS ENABLED + FORCED with NO policies, and all grants
--   are revoked from anon/authenticated. Only the service_role (used exclusively
--   by authenticated server routes) may touch them, exclusively through the
--   SECURITY DEFINER functions defined at the bottom of this file. The browser
--   can never read or write these tables directly.
-- ============================================================================

-- gen_random_uuid() lives in pgcrypto. Supabase ships it; ensure it is present.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- marketing_preferences
--   One row per user, created ONLY when the customer actively changes their
--   preference. No email address is stored here (the auth user owns the email).
--   Absence of a row means "unknown" and therefore INELIGIBLE.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_preferences (
  user_id                 uuid        PRIMARY KEY
                                       REFERENCES auth.users(id) ON DELETE CASCADE,
  email_marketing_enabled boolean     NOT NULL DEFAULT false,
  consented_at            timestamptz,
  consent_source          text,
  consent_version         text,
  unsubscribed_at         timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  -- An ENABLED preference must record when/where/which-version it was consented.
  -- A DISABLED preference has no such requirement (and may carry unsubscribed_at).
  CONSTRAINT marketing_preferences_enabled_requires_consent CHECK (
    email_marketing_enabled = false
    OR (
      consented_at    IS NOT NULL
      AND consent_source  IS NOT NULL
      AND consent_version IS NOT NULL
    )
  )
);

COMMENT ON TABLE public.marketing_preferences IS
  'One row per user, created only when the customer actively sets a preference. No email stored. Absence of a row = unknown = ineligible.';

-- ----------------------------------------------------------------------------
-- marketing_preference_events
--   Append-only audit log of preference history. NEVER read on normal public
--   page loads — it exists purely for history/debugging/compliance.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_preference_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL,
  event_type      text        NOT NULL,
  source          text        NOT NULL,
  consent_version text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT marketing_preference_events_type_chk CHECK (
    event_type IN ('subscribed', 'unsubscribed', 'preference_updated')
  )
);

CREATE INDEX IF NOT EXISTS marketing_preference_events_user_idx
  ON public.marketing_preference_events (user_id, created_at DESC);

COMMENT ON TABLE public.marketing_preference_events IS
  'Append-only preference history. Must never be queried on normal public page loads.';

-- ----------------------------------------------------------------------------
-- marketing_suppressions
--   Active suppression rows block sending regardless of preference. email_lc is
--   always trimmed + lowercased. A row is ACTIVE while revoked_at IS NULL.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_suppressions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid,
  email_lc          text        NOT NULL,
  reason            text        NOT NULL,
  source            text        NOT NULL,
  provider_event_id text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz,
  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT marketing_suppressions_reason_chk CHECK (
    reason IN ('unsubscribe', 'hard_bounce', 'complaint', 'manual', 'invalid_address')
  ),
  -- Enforce trimmed + lowercase email at the database level.
  CONSTRAINT marketing_suppressions_email_lc_chk CHECK (
    email_lc = lower(email_lc) AND email_lc = btrim(email_lc) AND length(email_lc) > 0
  )
);

-- Only one ACTIVE suppression per (email, reason).
CREATE UNIQUE INDEX IF NOT EXISTS marketing_suppressions_active_email_reason_uidx
  ON public.marketing_suppressions (email_lc, reason)
  WHERE revoked_at IS NULL;

-- Fast ACTIVE lookup by email.
CREATE INDEX IF NOT EXISTS marketing_suppressions_active_email_idx
  ON public.marketing_suppressions (email_lc)
  WHERE revoked_at IS NULL;

-- Fast ACTIVE lookup by user id.
CREATE INDEX IF NOT EXISTS marketing_suppressions_active_user_idx
  ON public.marketing_suppressions (user_id)
  WHERE revoked_at IS NULL AND user_id IS NOT NULL;

-- A provider delivery event may only be recorded once.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_suppressions_provider_event_uidx
  ON public.marketing_suppressions (provider_event_id)
  WHERE provider_event_id IS NOT NULL;

COMMENT ON TABLE public.marketing_suppressions IS
  'Active suppression rows (revoked_at IS NULL) block marketing sending by email or user id. email_lc is always trimmed + lowercased.';

-- ============================================================================
-- Security: RLS ENABLED + FORCED, NO policies, no anon/authenticated grants.
-- The browser must never read or write these tables directly. Only service_role
-- (which bypasses RLS) touches them, and only via the functions below.
-- ============================================================================
ALTER TABLE public.marketing_preferences        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_preferences        FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.marketing_preference_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_preference_events  FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.marketing_suppressions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_suppressions       FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.marketing_preferences       FROM anon, authenticated;
REVOKE ALL ON public.marketing_preference_events FROM anon, authenticated;
REVOKE ALL ON public.marketing_suppressions      FROM anon, authenticated;

-- Explicit, minimal grants for the trusted server role.
GRANT SELECT, INSERT, UPDATE ON public.marketing_preferences       TO service_role;
GRANT SELECT, INSERT         ON public.marketing_preference_events  TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.marketing_suppressions       TO service_role;

-- ============================================================================
-- Functions (SECURITY DEFINER, service_role-only via EXECUTE grant).
-- Every function locks its search_path and is transactional/idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- set_marketing_email_preference: enable or disable marketing for one user.
--   Enabling  -> upsert enabled + consent metadata, clear unsubscribed_at,
--                revoke ONLY active 'unsubscribe' suppressions, audit 'subscribed'.
--   Disabling -> upsert disabled + unsubscribed_at, add/preserve an active
--                'unsubscribe' suppression, audit 'unsubscribed'.
--   Never revokes hard_bounce / complaint / manual / invalid_address rows.
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
  v_email text := btrim(lower(coalesce(p_email_lc, '')));
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

  IF p_enabled THEN
    IF coalesce(p_consent_version, '') = '' THEN
      RAISE EXCEPTION 'p_consent_version is required when enabling';
    END IF;

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

    -- Re-enabling only lifts a prior *unsubscribe*. Bounce/complaint/manual/
    -- invalid-address suppressions remain active and continue to block sending.
    UPDATE public.marketing_suppressions
       SET revoked_at = now()
     WHERE revoked_at IS NULL
       AND reason = 'unsubscribe'
       AND (email_lc = v_email OR user_id = p_user_id);

    INSERT INTO public.marketing_preference_events (user_id, event_type, source, consent_version)
    VALUES (p_user_id, 'subscribed', p_source, p_consent_version);
  ELSE
    INSERT INTO public.marketing_preferences AS mp (
      user_id, email_marketing_enabled, unsubscribed_at, consent_source, updated_at
    )
    VALUES (p_user_id, false, now(), p_source, now())
    ON CONFLICT (user_id) DO UPDATE SET
      email_marketing_enabled = false,
      unsubscribed_at         = now(),
      updated_at              = now();

    -- Add an active unsubscribe suppression only if one is not already active.
    INSERT INTO public.marketing_suppressions (user_id, email_lc, reason, source)
    SELECT p_user_id, v_email, 'unsubscribe', p_source
    WHERE NOT EXISTS (
      SELECT 1 FROM public.marketing_suppressions
       WHERE revoked_at IS NULL AND reason = 'unsubscribe' AND email_lc = v_email
    );

    INSERT INTO public.marketing_preference_events (user_id, event_type, source)
    VALUES (p_user_id, 'unsubscribed', p_source);
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- unsubscribe_marketing_email: disable marketing via a signed token flow.
--   Thin, idempotent wrapper around the disable path. Safe to call repeatedly.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unsubscribe_marketing_email(
  p_user_id  uuid,
  p_email_lc text,
  p_source   text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.set_marketing_email_preference(p_user_id, p_email_lc, false, p_source, NULL);
END;
$$;

-- ----------------------------------------------------------------------------
-- is_marketing_email_eligible: the single source of truth for FUTURE jobs.
--   TRUE only when the preference is enabled AND no active suppression exists
--   for the email OR the user id. Absence of a preference row returns FALSE.
--   Do NOT call from public pages, checkout, or transactional email.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_marketing_email_eligible(
  p_user_id  uuid,
  p_email_lc text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.marketing_preferences
       WHERE user_id = p_user_id AND email_marketing_enabled = true
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.marketing_suppressions
       WHERE revoked_at IS NULL AND email_lc = btrim(lower(coalesce(p_email_lc, '')))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.marketing_suppressions
       WHERE revoked_at IS NULL AND user_id = p_user_id
    );
$$;

-- ----------------------------------------------------------------------------
-- marketing_can_reenable: may the customer turn marketing back ON?
--   FALSE when a NON-unsubscribe suppression (hard_bounce / complaint / manual /
--   invalid_address) is active for the email or user id. A normal unsubscribe
--   never blocks re-enabling. Returns a boolean only — the account UI must not
--   learn the specific suppression reason. Consumed by lib/marketing/service.ts
--   (getMarketingPreferenceState) so the "what blocks re-enable" rule lives in
--   exactly one place, next to the suppression data.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketing_can_reenable(
  p_user_id  uuid,
  p_email_lc text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.marketing_suppressions
     WHERE revoked_at IS NULL
       AND reason <> 'unsubscribe'
       AND (
         email_lc = btrim(lower(coalesce(p_email_lc, '')))
         OR user_id = p_user_id
       )
  );
$$;

-- Functions are callable ONLY by the trusted server role.
REVOKE ALL ON FUNCTION public.set_marketing_email_preference(uuid, text, boolean, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.unsubscribe_marketing_email(uuid, text, text)                    FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_marketing_email_eligible(uuid, text)                          FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.marketing_can_reenable(uuid, text)                               FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_marketing_email_preference(uuid, text, boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.unsubscribe_marketing_email(uuid, text, text)                    TO service_role;
GRANT EXECUTE ON FUNCTION public.is_marketing_email_eligible(uuid, text)                          TO service_role;
GRANT EXECUTE ON FUNCTION public.marketing_can_reenable(uuid, text)                               TO service_role;

-- ============================================================================
-- End of Stage 0 migration. No email is sent and no sending capability exists.
-- ============================================================================
