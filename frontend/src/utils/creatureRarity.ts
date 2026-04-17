export type CreatureRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export type CreatureType =
  | 'firefly'
  | 'water_strider'
  | 'frog'
  | 'dragonfly'
  | 'butterfly'
  | 'fish'
  | 'turtle'
  | 'golden_koi'
  | 'neon_phoenix'
  | 'glowing_jellyfish';

export interface CreaturePick {
  creatureType: CreatureType;
  rarity: CreatureRarity;
}

// Distribution targets (must sum to 100):
//   common    50%
//   uncommon  35%
//   rare      12%
//   legendary  3%
// Source: ux-design-specification.md § "Randomized delight".
const TIER_WEIGHTS: ReadonlyArray<{ rarity: CreatureRarity; weight: number }> = [
  { rarity: 'common', weight: 50 },
  { rarity: 'uncommon', weight: 35 },
  { rarity: 'rare', weight: 12 },
  { rarity: 'legendary', weight: 3 },
];

const TIER_POOLS: Record<CreatureRarity, ReadonlyArray<CreatureType>> = {
  common: ['firefly', 'water_strider'],
  uncommon: ['frog', 'dragonfly', 'butterfly'],
  rare: ['fish', 'turtle'],
  legendary: ['golden_koi', 'neon_phoenix', 'glowing_jellyfish'],
};

// Module-load invariants: weights sum to 100 and every pool is non-empty.
// Guards against future drift that would silently reroute rolls or ship an
// undefined creatureType to the backend.
const WEIGHT_SUM = TIER_WEIGHTS.reduce((a, w) => a + w.weight, 0);
if (WEIGHT_SUM !== 100) {
  throw new Error(`creatureRarity: TIER_WEIGHTS must sum to 100, got ${WEIGHT_SUM}`);
}
for (const { rarity } of TIER_WEIGHTS) {
  if (TIER_POOLS[rarity].length === 0) {
    throw new Error(`creatureRarity: TIER_POOLS['${rarity}'] is empty`);
  }
}

function pickTier(): CreatureRarity {
  const roll = Math.random() * 100;
  let acc = 0;
  for (const { rarity, weight } of TIER_WEIGHTS) {
    acc += weight;
    if (roll < acc) return rarity;
  }
  // Unreachable under the sum-to-100 invariant above; if drift ever slips
  // through (e.g. weights drop to 99) fall through to the *heaviest* tier
  // rather than silently reclassifying top-tier rolls as common.
  return TIER_WEIGHTS[TIER_WEIGHTS.length - 1].rarity;
}

export function pickCreatureByRarity(): CreaturePick {
  const rarity = pickTier();
  const pool = TIER_POOLS[rarity];
  const creatureType = pool[Math.floor(Math.random() * pool.length)];
  return { creatureType, rarity };
}

export function creaturesInTier(rarity: CreatureRarity): ReadonlyArray<CreatureType> {
  return TIER_POOLS[rarity];
}
