-- Fix board stroke writes from Flutter Web.
-- Flutter Color.value stores unsigned ARGB values such as 0xFFFFFFFF
-- (4294967295), which is larger than Postgres signed integer.

alter table public.meeting_whiteboard_strokes
  alter column color type bigint using color::bigint;

alter table public.meeting_whiteboard_strokes
  alter column color set default 4282020808;
