CREATE TABLE IF NOT EXISTS public.sportlink_booking_notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (
    notification_type IN ('accepted', 'cancelled', 'rejected', 'rescheduled', 'reminder_24h')
  ),
  lesson_date date NOT NULL,
  lesson_time time NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  processed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);

CREATE INDEX IF NOT EXISTS sportlink_booking_notification_queue_pending_idx
  ON public.sportlink_booking_notification_queue (created_at)
  WHERE processed_at IS NULL;

ALTER TABLE public.sportlink_booking_notification_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sportlink_booking_notification_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sportlink_booking_notification_queue TO service_role;

CREATE OR REPLACE FUNCTION public.sportlink_enqueue_booking_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  notification_kind text;
BEGIN
  IF NEW.status::text IS DISTINCT FROM OLD.status::text THEN
    notification_kind := CASE NEW.status::text
      WHEN 'accepted' THEN 'accepted'
      WHEN 'cancelled' THEN 'cancelled'
      WHEN 'rejected' THEN 'rejected'
      ELSE NULL
    END;
  ELSIF (NEW.lesson_date, NEW.lesson_time) IS DISTINCT FROM (OLD.lesson_date, OLD.lesson_time)
    AND NEW.status::text IN ('pending', 'accepted') THEN
    notification_kind := 'rescheduled';
  END IF;

  IF notification_kind IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.sportlink_booking_notification_queue (
    booking_id, recipient_id, notification_type, lesson_date, lesson_time, dedupe_key
  )
  SELECT NEW.id, recipients.user_id, notification_kind, NEW.lesson_date, NEW.lesson_time,
         'event:' || gen_random_uuid()::text
  FROM (
    SELECT NEW.student_id AS user_id
    UNION
    SELECT coach.user_id
    FROM public.coaches AS coach
    WHERE coach.id = NEW.coach_id
  ) AS recipients
  WHERE recipients.user_id IS NOT NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sportlink_booking_notification_trigger ON public.bookings;
CREATE TRIGGER sportlink_booking_notification_trigger
AFTER UPDATE OF status, lesson_date, lesson_time ON public.bookings
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  OR OLD.lesson_date IS DISTINCT FROM NEW.lesson_date
  OR OLD.lesson_time IS DISTINCT FROM NEW.lesson_time
)
EXECUTE FUNCTION public.sportlink_enqueue_booking_notification();

REVOKE ALL ON FUNCTION public.sportlink_enqueue_booking_notification() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sportlink_enqueue_24h_booking_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  inserted_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  INSERT INTO public.sportlink_booking_notification_queue (
    booking_id, recipient_id, notification_type, lesson_date, lesson_time, dedupe_key
  )
  SELECT
    booking.id,
    recipients.user_id,
    'reminder_24h',
    booking.lesson_date,
    booking.lesson_time,
    'reminder:' || booking.id::text || ':' || recipients.user_id::text || ':' ||
      booking.lesson_date::text || ':' || booking.lesson_time::text
  FROM public.bookings AS booking
  JOIN public.coaches AS coach ON coach.id = booking.coach_id
  CROSS JOIN LATERAL (
    SELECT booking.student_id AS user_id
    UNION
    SELECT coach.user_id
  ) AS recipients
  WHERE booking.status::text = 'accepted'
    AND ((booking.lesson_date + booking.lesson_time) AT TIME ZONE 'Asia/Taipei')
      > now() + interval '24 hours'
    AND ((booking.lesson_date + booking.lesson_time) AT TIME ZONE 'Asia/Taipei')
      <= now() + interval '24 hours 5 minutes'
  ON CONFLICT (dedupe_key) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.sportlink_claim_booking_notifications(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  booking_id uuid,
  recipient_id uuid,
  notification_type text,
  lesson_date date,
  lesson_time time
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT queue.id
    FROM public.sportlink_booking_notification_queue AS queue
    WHERE queue.processed_at IS NULL
      AND (queue.claimed_at IS NULL OR queue.claimed_at < now() - interval '10 minutes')
    ORDER BY queue.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 100)
  )
  UPDATE public.sportlink_booking_notification_queue AS queue
  SET claimed_at = now(), attempts = queue.attempts + 1
  FROM candidates
  WHERE queue.id = candidates.id
  RETURNING queue.id, queue.booking_id, queue.recipient_id, queue.notification_type,
            queue.lesson_date, queue.lesson_time;
END;
$$;

CREATE OR REPLACE FUNCTION public.sportlink_finish_booking_notification(
  p_notification_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  UPDATE public.sportlink_booking_notification_queue
  SET processed_at = CASE WHEN p_success OR attempts >= 5 THEN now() ELSE NULL END,
      claimed_at = NULL,
      last_error = CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error, 'Delivery failed'), 500) END
  WHERE id = p_notification_id AND processed_at IS NULL AND claimed_at IS NOT NULL;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.sportlink_enqueue_24h_booking_reminders() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sportlink_claim_booking_notifications(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sportlink_finish_booking_notification(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sportlink_enqueue_24h_booking_reminders() TO service_role;
GRANT EXECUTE ON FUNCTION public.sportlink_claim_booking_notifications(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.sportlink_finish_booking_notification(uuid, boolean, text) TO service_role;

CREATE TABLE IF NOT EXISTS public.sportlink_user_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('bug', 'abuse')),
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 2000),
  target text CHECK (target IS NULL OR char_length(target) <= 500),
  attachment_path text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'resolved', 'closed')),
  admin_note text CHECK (admin_note IS NULL OR char_length(admin_note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sportlink_user_reports_status_created_idx
  ON public.sportlink_user_reports (status, created_at DESC);

ALTER TABLE public.sportlink_user_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sportlink_user_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sportlink_user_reports TO service_role;

CREATE OR REPLACE FUNCTION public.sportlink_can_upload_report_attachment(p_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.sportlink_user_reports AS report
    WHERE report.reporter_id = auth.uid()
      AND report.attachment_path = p_object_name
      AND left(p_object_name, char_length(auth.uid()::text || '/' || report.id::text || '.'))
        = auth.uid()::text || '/' || report.id::text || '.'
  );
$$;

REVOKE ALL ON FUNCTION public.sportlink_can_upload_report_attachment(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sportlink_can_upload_report_attachment(text) TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'sportlink-report-attachments',
  'sportlink-report-attachments',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS sportlink_report_attachment_insert ON storage.objects;
CREATE POLICY sportlink_report_attachment_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'sportlink-report-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND public.sportlink_can_upload_report_attachment(name)
);

DROP POLICY IF EXISTS sportlink_report_attachment_admin_read ON storage.objects;
CREATE POLICY sportlink_report_attachment_admin_read
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'sportlink-report-attachments'
  AND public.is_platform_admin()
);

DROP POLICY IF EXISTS sportlink_report_attachment_owner_delete ON storage.objects;
CREATE POLICY sportlink_report_attachment_owner_delete
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'sportlink-report-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE OR REPLACE FUNCTION public.sportlink_submit_report(
  p_report_id uuid,
  p_category text,
  p_description text,
  p_target text DEFAULT NULL,
  p_attachment_path text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  clean_description text := btrim(coalesce(p_description, ''));
  clean_target text := nullif(btrim(coalesce(p_target, '')), '');
  expected_prefix text;
  recent_report_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'login required';
  END IF;
  IF p_report_id IS NULL OR p_category IS NULL OR p_category NOT IN ('bug', 'abuse')
    OR char_length(clean_description) NOT BETWEEN 10 AND 2000
    OR char_length(coalesce(clean_target, '')) > 500 THEN
    RAISE EXCEPTION 'invalid report data';
  END IF;

  SELECT count(*)::integer
  INTO recent_report_count
  FROM public.sportlink_user_reports
  WHERE reporter_id = auth.uid()
    AND created_at > now() - interval '1 hour';
  IF recent_report_count >= 5 THEN
    RAISE EXCEPTION 'report limit reached; try again later';
  END IF;

  IF p_attachment_path IS NOT NULL THEN
    expected_prefix := auth.uid()::text || '/' || p_report_id::text || '.';
    IF left(p_attachment_path, char_length(expected_prefix)) IS DISTINCT FROM expected_prefix
      OR (right(p_attachment_path, 4) NOT IN ('.jpg', '.png') AND right(p_attachment_path, 5) <> '.webp') THEN
      RAISE EXCEPTION 'invalid report attachment';
    END IF;
  END IF;

  INSERT INTO public.sportlink_user_reports (
    id, reporter_id, category, description, target, attachment_path
  )
  VALUES (p_report_id, auth.uid(), p_category, clean_description, clean_target, p_attachment_path);

  RETURN p_report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sportlink_clear_report_attachment(
  p_report_id uuid,
  p_attachment_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'login required';
  END IF;

  UPDATE public.sportlink_user_reports AS report
  SET attachment_path = NULL, updated_at = now()
  WHERE report.id = p_report_id
    AND report.reporter_id = auth.uid()
    AND report.status = 'pending'
    AND report.attachment_path = p_attachment_path
    AND NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'sportlink-report-attachments'
        AND name = p_attachment_path
    );

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.sportlink_admin_list_reports()
RETURNS TABLE (
  id uuid,
  reporter_name text,
  category text,
  description text,
  target text,
  attachment_path text,
  status text,
  admin_note text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'admin access required';
  END IF;

  RETURN QUERY
  SELECT
    report.id,
    coalesce(nullif(btrim(auth_user.raw_user_meta_data ->> 'display_name'), ''), 'SportLink 會員'),
    report.category,
    report.description,
    report.target,
    report.attachment_path,
    report.status,
    report.admin_note,
    report.created_at
  FROM public.sportlink_user_reports AS report
  JOIN auth.users AS auth_user ON auth_user.id = report.reporter_id
  ORDER BY report.created_at DESC
  LIMIT 200;
END;
$$;

CREATE OR REPLACE FUNCTION public.sportlink_admin_update_report(
  p_report_id uuid,
  p_status text,
  p_admin_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  clean_note text := nullif(btrim(coalesce(p_admin_note, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'admin access required';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'in_progress', 'resolved', 'closed')
    OR char_length(coalesce(clean_note, '')) > 1000 THEN
    RAISE EXCEPTION 'invalid report update';
  END IF;

  UPDATE public.sportlink_user_reports
  SET status = p_status, admin_note = clean_note, updated_at = now()
  WHERE id = p_report_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.sportlink_submit_report(uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sportlink_clear_report_attachment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sportlink_admin_list_reports() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sportlink_admin_update_report(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sportlink_submit_report(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sportlink_clear_report_attachment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sportlink_admin_list_reports() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sportlink_admin_update_report(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
