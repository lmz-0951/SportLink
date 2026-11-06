# SportLink

SportLink is a static web app deployed on Vercel. Member authentication, coaching profiles, course bookings, open-play games, and community data use Supabase. The substitutions area is still a local browser demo.

## Local development

- Open this repository in VS Code or another editor.
- Use `node --check app.js` to check the main browser script.
- Supabase schema changes are in `supabase/migrations/`; apply them separately in the Supabase project.
- Never commit `.env.local`, Vercel project state, or service-role credentials.

## Deployment

The production sites are managed as separate Vercel projects. Deploy only when requested, and verify both production projects when publishing a shared release.

## Notifications and reports

The booking reminders and member report center require the database migration and scheduled Edge Function setup documented in [SUPABASE_NOTIFICATIONS_SETUP.md](./SUPABASE_NOTIFICATIONS_SETUP.md). These files do not activate the feature in Supabase by themselves.
