-- Hearth update: categories and "where to buy" for items.
-- Run once in Supabase → SQL Editor. Safe to run again; it only adds two empty columns.

alter table public.items
  add column if not exists category text check (char_length(category) <= 40),
  add column if not exists store    text check (char_length(store) <= 60);
