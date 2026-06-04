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
  lootEnemyId?:     string;
  poiId?:           string;
  containerItemId?: string;
  toolItemId?:      string;
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
  // D1: new fields
  id?:                   string;
  isContainer?:          boolean;
  containerInventory?:   { itemId: string; itemName: string; investigationAc: number }[];
  isOpen?:               boolean;
  searchedBy?:           { characterId: string; roll: number }[];
  eligibleInteractions?: string[];
  effectiveTools?:       string[];
  armorClass?:           number;
  lockId?:               string;
  isLocked?:             boolean;
  isDestroyed?:          boolean;
  poiId?:                string;
}

export interface BuildCandidatesInput {
  playerPos:             Pos;
  enemies:               Enemy[];
  weaponRangeFeet:       number;
  remainingMovementFeet: number;
  gameTiles?:            GameTile[][];
  pois?:                 Poi[];
  // D2: new interaction inputs
  defeatedEnemies?: { id: string; name: string; x: number; y: number; lootItemIds: string[] }[];
  playerInventory?: { itemId: string; interactionTags: string[]; keyId?: string }[];
  currentCharId?:   string;
  investigationMod?: number;
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

function chebyshev(a: Pos, b: Pos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function buildChipCandidates(input: BuildCandidatesInput): ChipCandidate[] {
  const {
    playerPos, enemies, weaponRangeFeet, remainingMovementFeet, gameTiles: mapTiles, pois,
    defeatedEnemies, playerInventory, currentCharId,
  } = input;
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

  // D3: Loot candidates — defeated adjacent enemies with lootable items
  let lootCount = 0;
  for (const enemy of (defeatedEnemies ?? [])) {
    if (enemy.lootItemIds.length === 0) continue;
    if (chebyshev(playerPos, { x: enemy.x, y: enemy.y }) > 1) continue;
    if (mapTiles && !los(playerPos, { x: enemy.x, y: enemy.y }, mapTiles)) continue;
    candidates.push({
      candidateId:      String(candidates.length),
      actionTarget:     { x: enemy.x, y: enemy.y },
      targetName:       enemy.name,
      action_type:      "loot",
      movementFeet:     0,
      endPosition:      { ...playerPos },
      requiresMovement: false,
      lootEnemyId:      enemy.id,
    });
    lootCount++;
  }

  // D4: Container open candidates
  // D5: Container item pickup candidates
  // D6: Key use candidates
  // D7: Terrain demolition candidates
  // D8: Strength bash candidates
  let openContainerCount = 0;
  let pickupCandidateCount = 0;
  let keyUseCandidateCount = 0;
  let demolishCount = 0;
  let bashCount = 0;

  for (const poi of (pois ?? [])) {
    if (poi.isDestroyed) continue;
    const poiPos = { x: poi.x, y: poi.y };
    const dist = chebyshev(playerPos, poiPos);

    if (dist <= 1) {
      // D4: Container open
      if (poi.isContainer && !poi.isOpen) {
        const poiId = poi.id ?? poi.poiId;
        if (poiId) {
          candidates.push({
            candidateId:      String(candidates.length),
            actionTarget:     poiPos,
            targetName:       poi.name,
            action_type:      "container_open",
            movementFeet:     0,
            endPosition:      { ...playerPos },
            requiresMovement: false,
            poiId,
          });
          openContainerCount++;
        }
      }

      // D5: Container item pickup
      if (poi.isContainer && poi.isOpen) {
        const poiId = poi.id ?? poi.poiId;
        if (poiId) {
          const searchEntry = poi.searchedBy?.find(s => s.characterId === currentCharId);
          const roll = searchEntry?.roll ?? 0;
          for (const slot of (poi.containerInventory ?? [])) {
            if (roll > slot.investigationAc) {
              candidates.push({
                candidateId:      String(candidates.length),
                actionTarget:     poiPos,
                targetName:       slot.itemName,
                action_type:      "container_pickup",
                movementFeet:     0,
                endPosition:      { ...playerPos },
                requiresMovement: false,
                poiId,
                containerItemId:  slot.itemId,
              });
              pickupCandidateCount++;
            }
          }
        }
      }

      // D6: Key use candidates
      const poiId = poi.id ?? poi.poiId;
      if (poi.isLocked && poi.lockId && poiId) {
        const matchingKey = playerInventory?.find(i => i.keyId === poi.lockId);
        if (matchingKey) {
          candidates.push({
            candidateId:      String(candidates.length),
            actionTarget:     poiPos,
            targetName:       poi.name,
            action_type:      "key_use",
            movementFeet:     0,
            endPosition:      { ...playerPos },
            requiresMovement: false,
            poiId,
            toolItemId:       matchingKey.itemId,
          });
          keyUseCandidateCount++;
        }
      }

      // D7: Terrain demolition candidates
      if ((poi.eligibleInteractions ?? []).includes("tool_demolition") && poiId) {
        for (const invItem of (playerInventory ?? [])) {
          const intersection = invItem.interactionTags.filter(tag =>
            (poi.effectiveTools ?? []).includes(tag)
          );
          if (intersection.length > 0) {
            candidates.push({
              candidateId:      String(candidates.length),
              actionTarget:     poiPos,
              targetName:       poi.name,
              action_type:      "terrain_demolish",
              movementFeet:     0,
              endPosition:      { ...playerPos },
              requiresMovement: false,
              poiId,
              toolItemId:       invItem.itemId,
            });
            demolishCount++;
            break; // one candidate per POI per tool type
          }
        }
      }

      // D8: Strength bash candidates
      if ((poi.eligibleInteractions ?? []).includes("strength_bash") && poiId) {
        candidates.push({
          candidateId:      String(candidates.length),
          actionTarget:     poiPos,
          targetName:       poi.name,
          action_type:      "terrain_bash",
          movementFeet:     0,
          endPosition:      { ...playerPos },
          requiresMovement: false,
          poiId,
        });
        bashCount++;
      }
    }
  }

  console.log("[chip-candidates] loot candidates", defeatedEnemies?.map(e => ({ id: e.id, name: e.name, lootCount: e.lootItemIds.length })) ?? []);
  console.log("[chip-candidates] container candidates", { open: openContainerCount, pickup: pickupCandidateCount, keyUse: keyUseCandidateCount });
  console.log("[chip-candidates] terrain candidates", { demolish: demolishCount, bash: bashCount });

  // Case 3: movement chips for reachable POIs (skip locked POIs — player must unlock first)
  for (const poi of (pois ?? [])) {
    if (poi.isLocked) continue;
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

    if (cand.action_type === "loot") {
      label        = `Loot ${cand.targetName}`;
      type         = "none";
      requiresRoll = false;
    } else if (cand.action_type === "container_open") {
      label        = `Open ${cand.targetName} (${cand.actionTarget.x},${cand.actionTarget.y})`;
      type         = "investigation";
      requiresRoll = true;
    } else if (cand.action_type === "container_pickup") {
      label        = `Take ${cand.targetName}`;
      type         = "none";
      requiresRoll = false;
    } else if (cand.action_type === "key_use") {
      label        = `Unlock ${cand.targetName} with key`;
      type         = "none";
      requiresRoll = false;
    } else if (cand.action_type === "terrain_demolish") {
      label        = `Use tool on ${cand.targetName} (${cand.actionTarget.x},${cand.actionTarget.y})`;
      type         = "strength";
      requiresRoll = true;
    } else if (cand.action_type === "terrain_bash") {
      label        = `Bash ${cand.targetName} (${cand.actionTarget.x},${cand.actionTarget.y})`;
      type         = "strength";
      requiresRoll = true;
    } else if (cand.action_type === "movement") {
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
      lootEnemyId:    cand.lootEnemyId,
      poiId:          cand.poiId,
      containerItemId: cand.containerItemId,
      toolItemId:     cand.toolItemId,
    };
  });

  for (const pad of PADDING_CHIPS) {
    if (chips.length >= 3) break;
    chips.push({ ...pad, id: randomUUID(), endPosition: { ...playerPos }, actionTarget: { ...playerPos } });
  }

  return chips;
}
