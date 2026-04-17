import { describe, it, expect } from 'vitest';
import {
  pickCreatureByRarity,
  creaturesInTier,
  type CreatureRarity,
} from './creatureRarity';

describe('pickCreatureByRarity', () => {
  it('returns a creatureType from the selected tier pool', () => {
    for (let i = 0; i < 500; i++) {
      const { creatureType, rarity } = pickCreatureByRarity();
      const pool = creaturesInTier(rarity);
      expect(pool).toContain(creatureType);
    }
  });

  it('tier distribution across 10k rolls is within ±3 percentage points of targets', () => {
    const counts: Record<CreatureRarity, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      legendary: 0,
    };
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const { rarity } = pickCreatureByRarity();
      counts[rarity]++;
    }
    const observed = {
      common: (counts.common / N) * 100,
      uncommon: (counts.uncommon / N) * 100,
      rare: (counts.rare / N) * 100,
      legendary: (counts.legendary / N) * 100,
    };
    const targets = { common: 50, uncommon: 35, rare: 12, legendary: 3 };
    const tolerance = 3;
    for (const key of Object.keys(targets) as CreatureRarity[]) {
      const diff = Math.abs(observed[key] - targets[key]);
      expect(
        diff,
        `tier ${key}: observed ${observed[key].toFixed(2)}% vs target ${targets[key]}%`,
      ).toBeLessThanOrEqual(tolerance);
    }
  });
});

describe('creaturesInTier', () => {
  it('common pool is firefly, water_strider', () => {
    expect(creaturesInTier('common')).toEqual(['firefly', 'water_strider']);
  });

  it('uncommon pool is frog, dragonfly, butterfly', () => {
    expect(creaturesInTier('uncommon')).toEqual(['frog', 'dragonfly', 'butterfly']);
  });

  it('rare pool is fish, turtle', () => {
    expect(creaturesInTier('rare')).toEqual(['fish', 'turtle']);
  });

  it('legendary pool is golden_koi, neon_phoenix, glowing_jellyfish', () => {
    expect(creaturesInTier('legendary')).toEqual([
      'golden_koi',
      'neon_phoenix',
      'glowing_jellyfish',
    ]);
  });
});
