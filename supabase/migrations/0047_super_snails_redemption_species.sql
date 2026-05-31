-- 0047_super_snails_redemption_species.sql
--
-- Adds the secret redeem-only Super Snails companion species to redemption
-- codes. Raw codes stay out of the database and the repo; admins seed
-- SHA-256 hashes through the SQL editor/service role only.

do $$
begin
  alter table public.redemption_codes
    drop constraint if exists redemption_codes_reward_pet_species_check;

  alter table public.redemption_codes
    add constraint redemption_codes_reward_pet_species_check
    check (
      reward_pet_species in (
        'fox',
        'bunny',
        'bear',
        'duck',
        'kitten',
        'puppy',
        'calico',
        'lamb',
        'panda',
        'dragon',
        'super-snails'
      )
    );
end;
$$;
