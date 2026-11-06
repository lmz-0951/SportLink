# SportLink notifications and reports

The booking reminders and report center are prepared in this branch but are not active until the database migration and notification worker are installed in Supabase.

## Database

Run `supabase/migrations/20261107010000_booking_notifications_and_reports.sql` in the Supabase SQL Editor. It creates the private report-attachment bucket, report RPCs, the booking notification queue, and triggers for booking acceptance, rejection, cancellation, and rescheduling.

## Booking push worker

1. Deploy `supabase/functions/sportlink-process-booking-notifications/index.ts` as the `sportlink-process-booking-notifications` Edge Function with JWT verification disabled. The function checks its own `x-sportlink-cron-secret` header.
2. Keep the existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, and `VAPID_PRIVATE_KEY` Edge Function secrets. Add a new high-entropy `SPORTLINK_NOTIFICATION_CRON_SECRET` in Supabase Edge Function Secrets; do not commit its value.
3. Enable Supabase Cron, `pg_net`, and Vault if they are not enabled. Store the same random secret in Vault as `sportlink_notification_cron_secret`.
4. Schedule this SQL in the Supabase SQL Editor, replacing `<PROJECT_REF>`:

```sql
select cron.schedule(
  'sportlink-booking-notifications',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sportlink-process-booking-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sportlink-cron-secret',
        (select decrypted_secret
         from vault.decrypted_secrets
         where name = 'sportlink_notification_cron_secret')
      ),
      body := '{}'::jsonb
    );
  $job$
);
```

The worker checks for lessons 24 hours ahead (within a five-minute window) and processes queued booking updates. It retries failed deliveries up to five times. Each student and coach must enable push notifications on each device where they want to receive alerts.

## Reports

After applying the migration, signed-in members can submit a website issue or an abuse report from **My Center → Report an issue / report content**. Screenshots are optional JPG, PNG, or WebP files up to 5 MB and are stored in a private bucket. Only authorized platform administrators can read reports or create temporary screenshot links.

No Supabase migration, Edge Function deployment, Git push, or website deployment is performed by editing these files locally.
