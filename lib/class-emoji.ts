// One emoji per class, used on the map grid and in party cards.
// Add new classes here and they'll appear everywhere automatically.
const CLASS_EMOJIS: Record<string, string> = {
  Fighter: "⚔️",
  Wizard:  "🔮",
  Rogue:   "🗡️",
  Cleric:  "✨",
};

export function classEmoji(characterClass: string): string {
  return CLASS_EMOJIS[characterClass] ?? "🎲";
}
