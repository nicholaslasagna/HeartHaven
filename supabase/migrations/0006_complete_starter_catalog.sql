-- Keep the database starter catalog aligned with the playable room starter layout.

insert into public.catalog_items
  (id, category, name, description, price_coins, price_hearts, rarity, asset_key, placement_type, tags)
values
  ('bed-cream-canopy', 'furniture', 'Cream Canopy Bed', 'A soft tucked-in bed where your companion can curl up after garden watch.', 320, 2, 'common', 'bed-cream', 'floor', array['room', 'sleep']),
  ('table-honey-tea', 'furniture', 'Honey Tea Table', 'A tiny round table for moonberry tea and handwritten notes.', 165, 1, 'common', 'table-honey', 'floor', array['room', 'tea']),
  ('shelf-memory-oak', 'furniture', 'Memory Oak Shelf', 'A warm little shelf for keepsakes, shells, and saved letters.', 210, 1, 'common', 'shelf-oak', 'wall', array['room', 'memory']),
  ('plant-sweetfern-pot', 'decor', 'Sweetfern Pot', 'A leafy plant that sways whenever the room feels loved.', 105, 0, 'starter', 'plant-sweetfern', 'floor', array['room', 'plant'])
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  price_coins = excluded.price_coins,
  price_hearts = excluded.price_hearts,
  rarity = excluded.rarity,
  asset_key = excluded.asset_key,
  placement_type = excluded.placement_type,
  tags = excluded.tags,
  active = true,
  updated_at = now();
