-- Apply on the COMMS Supabase project before deploying native FCM
-- registration endpoints. This migration has NOT been applied by CI.
-- Requires permission to ALTER public.notification_devices.
begin;
alter table public.notification_devices
  drop constraint if exists notification_devices_platform_check;
alter table public.notification_devices
  add constraint notification_devices_platform_check
  check (platform in ('web_pwa', 'android', 'ios'));
commit;
