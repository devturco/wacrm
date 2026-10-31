# Follow-up reminders

Set a **follow-up date** on any chat. crmbr adds a notification to the **Notifications** page (and the bell
count) **the day before** and **on the day**, and also sends a phone/desktop push if push is enabled
(see `push-notifications.md`).

## Use it
1. Open a chat → tap the **calendar button** in the chat header.
2. Pick a date (or Tomorrow / 3 days / 1 week / 1 month) and add a short note.
3. **Policy renewals:** enter the policy **expiry date** and tap **Set renewal reminder**. Renewals open 45 days
   before expiry, so the reminder is set for exactly that day (or tomorrow if the window is already open).
4. All open follow-ups are listed under **Follow-ups** in the sidebar: Overdue / Today / Tomorrow / Upcoming.
   Tap **Mark done** when finished. Rescheduling a follow-up gives it fresh reminders.

Reminders are sent after **9:00 AM Brasília time** (so nothing buzzes at midnight). Change with
`FOLLOWUP_TIMEZONE` and `FOLLOWUP_REMIND_HOUR`.

## One-time setup (self-hosters)
1. **Apply the migration** `supabase/migrations/070_conversation_followups.sql` in the Supabase SQL editor
   (adds one table + one function; safe to run twice).
2. **Redeploy** the website app.
3. **Background reminders** (so they arrive with crmbr closed):
   - **Railway (recomendado):** o serviço `cronjobs` já chama `/api/followups/cron` a cada 5 minutos
     (ver `automations-and-cron.md`). Só é preciso garantir que `AUTOMATION_CRON_SECRET` exista
     no serviço web **e** no `cronjobs`, com o mesmo valor.
   - **Coolify:** adicione uma variável de ambiente `AUTOMATION_CRON_SECRET` = qualquer texto
     aleatório longo (pule se já existir), redeploy, então abra o app → **Scheduled Tasks** → adicione:
     - Name: `followup-reminders`
     - Command: `wget -qO- --header="x-cron-secret: $AUTOMATION_CRON_SECRET" http://127.0.0.1:3000/api/followups/cron`
     - Frequency: `*/15 * * * *`
   Without this, reminders are still created whenever someone opens crmbr, but not in the background.

## How it works
`conversation_followups` stores the date. The database function `process_followup_reminders()` creates each
reminder exactly once (flags are set in the same statement), then the app pushes it to the person who set the
follow-up. Safe to run as often as you like.

## Roll back
Remove the scheduled task. Optionally `DROP TABLE conversation_followups;` and
`DROP FUNCTION process_followup_reminders(text, int);`. The app keeps working without them.
