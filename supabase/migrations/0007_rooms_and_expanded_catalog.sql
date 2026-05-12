-- Add room unlocks as a catalog category. Inserts live in the next migration so the enum value is committed first.

alter type public.item_category add value if not exists 'room';
