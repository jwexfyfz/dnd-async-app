import { abilityModifier } from "./dice";

export interface InitiativeSlot {
  actorId:     string;
  actorType:   "CHARACTER" | "ENEMY";
  initiative:  number;
  d20Roll:     number;
  modifier:    number;
  hasReaction: boolean;
  isSurprised: boolean;
}

export interface InitiativeActor {
  actorId:    string;
  actorType:  "CHARACTER" | "ENEMY";
  dexterity:  number;
}

export function rollInitiative(
  actors: InitiativeActor[],
  rollFn: () => number = () => Math.ceil(Math.random() * 20),
): InitiativeSlot[] {
  const withRolls = actors.map((a) => {
    const d20 = rollFn();
    const mod = abilityModifier(a.dexterity);
    return { ...a, d20Roll: d20, modifier: mod, initiative: d20 + mod, tieBreaker: rollFn() };
  });

  withRolls.sort((a, b) => {
    // 1. Higher total initiative wins
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    // 2. Player beats NPC on tie
    const aIsPlayer = a.actorType === "CHARACTER" ? 1 : 0;
    const bIsPlayer = b.actorType === "CHARACTER" ? 1 : 0;
    if (bIsPlayer !== aIsPlayer) return bIsPlayer - aIsPlayer;
    // 3. Higher flat DEX wins
    if (b.dexterity !== a.dexterity) return b.dexterity - a.dexterity;
    // 4. Secondary d20 tiebreaker
    return b.tieBreaker - a.tieBreaker;
  });

  return withRolls.map(({ actorId, actorType, initiative, d20Roll, modifier }) => ({
    actorId,
    actorType,
    initiative,
    d20Roll,
    modifier,
    hasReaction: true,
    isSurprised: false,
  }));
}
