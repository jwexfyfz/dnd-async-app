import { randomUUID } from "crypto";
import { diagonalDistance } from "./grid";
import { hasLineOfSight } from "./game-map-utils";
import type { GameTile } from "./tile-types";
import { tileBlocksMovement } from "./tile-types";
import type { ActionType, SuggestionChip } from "../types/suggestion-chip";
import type { ChipType } from "../types/chips";

type Pos = { x: number; y: number };

export interface ChipCandidate {
  candidateId:      string;
  actionTarget:     Pos;
  targetName:       string;
  action_type:      ActionType;
  movementFeet:     number;
  endPosition:      Pos;
  requiresMovement: boolean;
  itemId?:          string;
}

interface Enemy {
  id:    string;
  name:  string;
  hp:    number;
  maxHp: number;
  x:     number;
  y:     number;
}

interface Poi {
  name:    string;
  x:       number;
  y:       number;
  itemId?: string;
}

export interface BuildCandidatesInput {
  playerPos:             Pos;
  enemies:               Enemy[];
  weaponRangeFeet:       number;
  remainingMovementFeet: number;
  gameTiles?:            GameTile[][];
  pois?:                 Poi[];
}

const DIRS_8: Pos[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y:  0 },                   { x: 1, y:  0 },
  { x: -1, y:  1 }, { x: 0, y:  1 }, { x: 1, y:  1 },
];

function passable(pos: Pos, tiles?: GameTile[][]): boolean {
  if (!tiles) return true;
  const tile = tiles[pos.y]?.[pos.x];
  return tile !== undefined && !tileBlocksMovement(tile);
}

function los(from: Pos, to: Pos, tiles?: GameTile[][]): boolean {
  if (!tiles) return true;
  return hasLineOfSight(tiles, from.x, from.y, to.x, to.y);
}

export function buildChipCandidates(input: BuildCandidatesInput): ChipCandidate[] {
  const { playerPos, enemies, weaponRangeFeet, remainingMovementFeet, gameTiles: mapTiles, pois } = input;
  const candidates: ChipCandidate[] = [];
  const living = enemies.filter(e => e.hp > 0);

  for (const enemy of living) {
    const ePos     = { x: enemy.x, y: enemy.y };
    const distFeet = diagonalDistance(playerPos, ePos);
    const hasLoS   = los(playerPos, ePos, mapTiles);

    if (distFeet <= weaponRangeFeet && hasLoS) {
      // Case 1: in range with LoS — attack from current position
      candidates.push({
        candidateId:      String(candidates.length),
        actionTarget:     ePos,
        targetName:       enemy.name,
        action_type:      "mainAction",
        movementFeet:     0,
        endPosition:      { ...playerPos },
        requiresMovement: false,
      });
    } else {
      // Case 2: out of range or LoS blocked — move to best adjacent tile to attack
      let best: Pos | null = null;
      let bestCost = Infinity;
      for (const d of DIRS_8) {
        const tile: Pos = { x: enemy.x + d.x, y: enemy.y + d.y };
        if (!passable(tile, mapTiles)) continue;
        if (!los(tile, ePos, mapTiles)) continue;
        const cost = diagonalDistance(playerPos, tile);
        if (cost < bestCost) { bestCost = cost; best = tile; }
      }
      if (best !== null && bestCost > 0 && bestCost <= remainingMovementFeet) {
        candidates.push({
          candidateId:      String(candidates.length),
          actionTarget:     ePos,
          targetName:       enemy.name,
          action_type:      "mainAction",
          movementFeet:     bestCost,
          endPosition:      best,
          requiresMovement: true,
        });
      }
    }
  }

  // Case 3: movement chips for reachable POIs
  for (const poi of (pois ?? [])) {
    const dest: Pos = { x: poi.x, y: poi.y };
    const cost = diagonalDistance(playerPos, dest);
    if (cost === 0 || cost > remainingMovementFeet) continue;
    candidates.push({
      candidateId:      String(candidates.length),
      actionTarget:     dest,
      targetName:       poi.name,
      action_type:      "movement",
      movementFeet:     cost,
      endPosition:      dest,
      requiresMovement: true,
      itemId:           poi.itemId,
    });
  }

  // Case 4: self-targeting (search, investigate, disengage, etc.)
  candidates.push({
    candidateId:      String(candidates.length),
    actionTarget:     { ...playerPos },
    targetName:       "self",
    action_type:      "mainAction",
    movementFeet:     0,
    endPosition:      { ...playerPos },
    requiresMovement: false,
  });

  return candidates.slice(0, 8).map((c, i) => ({ ...c, candidateId: String(i) }));
}

// ─── Convert candidates to chips (no AI involvement) ─────────────────────────

const PADDING_CHIPS: Omit<SuggestionChip, "id" | "endPosition" | "actionTarget">[] = [
  { label: "Listen carefully",     type: "perception",    requiresRoll: true,  advantageState: "NONE", action_type: "mainAction", movementFeet: 0, spellLevel: 0 },
  { label: "Inspect surroundings", type: "perception",    requiresRoll: false, advantageState: "NONE", action_type: "mainAction", movementFeet: 0, spellLevel: 0 },
  { label: "Hold position",        type: "none",          requiresRoll: false, advantageState: "NONE", action_type: "mainAction", movementFeet: 0, spellLevel: 0 },
];

export function candidatesToChips(
  candidates: ChipCandidate[],
  weaponRangeFeet: number,
  playerPos: Pos,
): SuggestionChip[] {
  const isRanged = weaponRangeFeet > 5;
  const chips: SuggestionChip[] = candidates.slice(0, 5).map(cand => {
    let label: string;
    let type: ChipType;
    let requiresRoll: boolean;

    if (cand.action_type === "movement") {
      label        = `Move to ${cand.targetName} (${cand.actionTarget.x},${cand.actionTarget.y})`;
      type         = "athletics";
      requiresRoll = false;
    } else if (cand.targetName === "self") {
      label        = "Search the area";
      type         = "investigation";
      requiresRoll = true;
    } else if (cand.requiresMovement) {
      label        = `Advance on the ${cand.targetName} (${cand.actionTarget.x},${cand.actionTarget.y})`;
      type         = isRanged ? "dexterity" : "strength";
      requiresRoll = true;
    } else {
      label        = isRanged ? `Shoot the ${cand.targetName} (${cand.actionTarget.x},${cand.actionTarget.y})` : `Attack the ${cand.targetName} (${cand.actionTarget.x},${cand.actionTarget.y})`;
      type         = isRanged ? "dexterity" : "strength";
      requiresRoll = true;
    }

    return {
      id:             randomUUID(),
      label,
      type,
      requiresRoll,
      advantageState: "NONE",
      action_type:    cand.action_type,
      movementFeet:   cand.movementFeet,
      spellLevel:     0,
      endPosition:    cand.endPosition,
      actionTarget:   cand.actionTarget,
      itemId:         cand.itemId,
    };
  });

  for (const pad of PADDING_CHIPS) {
    if (chips.length >= 3) break;
    chips.push({ ...pad, id: randomUUID(), endPosition: { ...playerPos }, actionTarget: { ...playerPos } });
  }

  return chips;
}
