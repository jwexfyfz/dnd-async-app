export type WeaponType = "melee" | "reach" | "thrown" | "ranged_light" | "ranged_heavy";

// Canonical range in feet per weapon type. Used at seed time to populate
// Item.rangeFeet, and at runtime for chip-candidate distance checks.
export const WEAPON_RANGE_FEET: Record<WeaponType, number> = {
  melee:         5,   // standard melee (swords, daggers, clubs, fangs, claws)
  reach:         10,  // reach property (spears, polearms, whips, staves)
  thrown:        20,  // thrown weapons (handaxes, daggers thrown)
  ranged_light:  80,  // shortbow, light crossbow, hand crossbow
  ranged_heavy:  150, // longbow, heavy crossbow
};
