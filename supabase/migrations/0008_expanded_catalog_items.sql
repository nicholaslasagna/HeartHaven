-- Room unlocks and broader decoration catalog for the virtual world roadmap.

insert into public.catalog_items
  (id, category, name, description, price_coins, price_hearts, rarity, asset_key, placement_type, tags)
values
  ('sofa-blush-cloud', 'furniture', 'Blush Cloud Sofa', 'A soft sofa for room parties, pet naps, and cozy visits.', 420, 3, 'common', 'sofa-blush-cloud', 'floor', array['room', 'seat', 'party']),
  ('fireplace-honey-stone', 'furniture', 'Honey Stone Fireplace', 'Warm light, soft shadows, and a focal point for winter rooms.', 520, 4, 'rare', 'fireplace-honey-stone', 'wall', array['room', 'light', 'cozy']),
  ('piano-lavender-upright', 'furniture', 'Lavender Upright Piano', 'A playable-looking piano for date nights, recitals, and party rooms.', 680, 5, 'rare', 'piano-lavender-upright', 'floor', array['room', 'music', 'party']),
  ('game-table-garden', 'furniture', 'Garden Game Table', 'A small table for cards, board games, and multiplayer hangouts.', 380, 2, 'common', 'game-table-garden', 'floor', array['room', 'games', 'party']),
  ('pet-bed-moonberry', 'decor', 'Moonberry Pet Bed', 'A tiny plush bed where Casper and other companions can sleep.', 220, 2, 'common', 'pet-bed-moonberry', 'floor', array['pet', 'sleep', 'casper']),
  ('wardrobe-keeper-oak', 'furniture', 'Keeper Wardrobe', 'A wardrobe for future avatar outfits, colors, and cozy accessories.', 460, 3, 'common', 'wardrobe-keeper-oak', 'floor', array['avatar', 'customization', 'room']),
  ('fountain-lantern-patio', 'garden', 'Lantern Patio Fountain', 'A sparkling fountain for outdoor rooms and shared gardens.', 560, 4, 'rare', 'fountain-lantern-patio', 'garden_plot', array['garden', 'water', 'animated']),
  ('dance-rug-party-star', 'flooring', 'Starlit Party Rug', 'A glowing dance rug for parties, emotes, and group screenshots.', 340, 2, 'common', 'dance-rug-party-star', 'floor', array['party', 'room', 'emotes']),
  ('room-sunbeam-kitchen', 'room', 'Sunbeam Kitchen Room', 'Unlock a bright kitchen room for baking, snacks, and companion care.', 900, 8, 'common', 'room-sunbeam-kitchen', 'inventory_only', array['room-unlock', 'kitchen']),
  ('room-lavender-library', 'room', 'Lavender Library Room', 'Unlock a quiet library for memory pages, reading corners, and soft piano music.', 1100, 10, 'rare', 'room-lavender-library', 'inventory_only', array['room-unlock', 'library']),
  ('room-garden-patio', 'room', 'Lantern Garden Patio', 'Unlock an outdoor 2.5D patio connected to gardens and friend visits.', 1250, 12, 'rare', 'room-garden-patio', 'inventory_only', array['room-unlock', 'garden', 'party']),
  ('room-cloud-observatory', 'room', 'Cloud Observatory Room', 'Unlock a moonlit sky room for star watching, dates, and dreamy parties.', 1600, 16, 'rare', 'room-cloud-observatory', 'inventory_only', array['room-unlock', 'sky', 'date'])
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
