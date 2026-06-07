const CLASS_EMOJIS: Record<string, string> = {
  Artificer: "⚙️",
  Barbarian: "🪓",
  Bard:      "🎵",
  Cleric:    "⛪",
  Druid:     "🌿",
  Fighter:   "⚔️",
  Monk:      "🥋",
  Paladin:   "🛡️",
  Ranger:    "🏹",
  Rogue:     "🗡️",
  Sorcerer:  "🔥",
  Warlock:   "👁️",
  Wizard:    "🔮",
};

export function classEmoji(characterClass: string): string {
  return CLASS_EMOJIS[characterClass] ?? "🎲";
}

export function classSprite(characterClass: string): string {
  return `/sprites/${characterClass.toLowerCase()}.png`;
}
