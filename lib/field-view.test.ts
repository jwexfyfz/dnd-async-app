// ─── lib/field-view — layout payload verification tests ──────────────────────
// Verifies that the Field tab's passive rendering helpers load and produce clean
// output using only static, pre-saved text rows — no DB access, no AI calls,
// no async work of any kind.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  extractActiveNarrative,
  mapChipsToFieldProps,
  type CharacterAbilityScores,
} from "./field-view";
import type { Chip } from "../types/chips";

// ─── Static mock layout payload ───────────────────────────────────────────────
// Represents a pre-saved game state document exactly as it comes out of the DB.

const MOCK_CHARACTER: CharacterAbilityScores = {
  baseStrength:       16,   // +3
  baseDexterity:      14,   // +2
  baseConstitution:   14,   // +2
  baseIntelligence:   10,   // +0
  baseWisdom:         12,   // +1
  baseCharisma:       10,   // +0
  level:              3,
  skillProficiencies: ["Athletics", "Perception"],
};

const MOCK_CHIPS: Chip[] = [
  { text: "Press the assault",  type: "athletics"   },
  { text: "Scan for threats",   type: "perception"  },
  { text: "Hold your ground",   type: "strength"    },
  { text: "Shout a war cry",    type: "intimidation"},
];

const MOCK_NARRATIVE_HISTORY = [
  "The goblin snarls and lunges forward.",
  "Aldric's blade finds a gap in the armor.",
  "The corridor fills with the echo of steel.",
];

const DC = 14;

// ─── extractActiveNarrative ───────────────────────────────────────────────────

describe("extractActiveNarrative", () => {
  it("returns the last entry of a populated narrative_history", () => {
    const result = extractActiveNarrative(MOCK_NARRATIVE_HISTORY, "fallback");
    expect(result).toBe("The corridor fills with the echo of steel.");
  });

  it("returns the fallback when narrative_history is empty", () => {
    const result = extractActiveNarrative([], "A dungeon of doom awaits.");
    expect(result).toBe("A dungeon of doom awaits.");
  });

  it("returns the single entry from a one-item history", () => {
    const result = extractActiveNarrative(["Only event."], "fallback");
    expect(result).toBe("Only event.");
  });

  it("does not modify or trim the stored text", () => {
    const verbatim = "  Exactly as stored.  ";
    expect(extractActiveNarrative([verbatim], "fb")).toBe(verbatim);
  });
});

// ─── mapChipsToFieldProps ─────────────────────────────────────────────────────

describe("mapChipsToFieldProps — static layout payload", () => {
  it("produces one prop object per chip with no extra entries", () => {
    const props = mapChipsToFieldProps(MOCK_CHIPS, MOCK_CHARACTER, DC);
    expect(props).toHaveLength(MOCK_CHIPS.length);
  });

  it("maps chip text and type through verbatim", () => {
    const props = mapChipsToFieldProps(MOCK_CHIPS, MOCK_CHARACTER, DC);
    expect(props[0].text).toBe("Press the assault");
    expect(props[0].type).toBe("athletics");
    expect(props[1].text).toBe("Scan for threats");
    expect(props[1].type).toBe("perception");
  });

  it("sets data-dc from the provided DC argument on every chip", () => {
    const props = mapChipsToFieldProps(MOCK_CHIPS, MOCK_CHARACTER, DC);
    for (const p of props) {
      expect(p.dc).toBe(DC);
    }
  });

  it("computes data-modifier as ability-mod + proficiency bonus when proficient", () => {
    // Athletics maps to baseStrength (16 → +3). Level 3 proficiency bonus = +2.
    // Fighter proficient in Athletics → modifier = 3 + 2 = 5.
    const [athletics] = mapChipsToFieldProps(
      [{ text: "Press the assault", type: "athletics" }],
      MOCK_CHARACTER,
      DC,
    );
    expect(athletics.modifier).toBe(5);
    expect(athletics.modStr).toBe("+5");
  });

  it("computes data-modifier without proficiency bonus when not proficient", () => {
    // Intimidation maps to baseCharisma (10 → +0). Not proficient → modifier = 0.
    const [intimidation] = mapChipsToFieldProps(
      [{ text: "Shout a war cry", type: "intimidation" }],
      MOCK_CHARACTER,
      DC,
    );
    expect(intimidation.modifier).toBe(0);
    expect(intimidation.modStr).toBe("+0");
  });

  it("resolves the correct emoji and label for each chip type", () => {
    const props = mapChipsToFieldProps(MOCK_CHIPS, MOCK_CHARACTER, DC);
    const athleticsProp = props.find((p) => p.type === "athletics")!;
    expect(athleticsProp.emoji).toBe("💪");
    expect(athleticsProp.label).toBe("Athletics");
  });

  it("renders cleanly from a fully static pre-saved payload — all fields are valid primitives", () => {
    const props = mapChipsToFieldProps(MOCK_CHIPS, MOCK_CHARACTER, DC);
    for (const p of props) {
      expect(typeof p.text).toBe("string");
      expect(p.text.length).toBeGreaterThan(0);
      expect(typeof p.type).toBe("string");
      expect(typeof p.dc).toBe("number");
      expect(Number.isFinite(p.dc)).toBe(true);
      expect(typeof p.modifier).toBe("number");
      expect(Number.isFinite(p.modifier)).toBe(true);
      expect(typeof p.modStr).toBe("string");
      expect(p.modStr).toMatch(/^[+-]\d+$/);
      expect(typeof p.label).toBe("string");
      expect(typeof p.emoji).toBe("string");
    }
  });

  it("handles an empty chip array without errors", () => {
    const props = mapChipsToFieldProps([], MOCK_CHARACTER, DC);
    expect(props).toEqual([]);
  });

  it("falls back gracefully for an unknown chip type", () => {
    const weirdChip: Chip = { text: "Do something odd", type: "investigation" as any };
    expect(() => mapChipsToFieldProps([weirdChip], MOCK_CHARACTER, DC)).not.toThrow();
    const [prop] = mapChipsToFieldProps([weirdChip], MOCK_CHARACTER, DC);
    expect(typeof prop.modifier).toBe("number");
  });
});

// ─── End-to-end layout composition ───────────────────────────────────────────
// Simulates what the component does on mount: read narrative + map chips.

describe("Field tab passive layout composition", () => {
  it("assembles the complete screen payload from a static game state document", () => {
    // Mimic exactly what happens in the mounting useEffect:
    const situationText = extractActiveNarrative(
      MOCK_NARRATIVE_HISTORY,
      "Shadows cling to every stone.",
    );
    const chipProps = mapChipsToFieldProps(MOCK_CHIPS, MOCK_CHARACTER, DC);

    // The situation text is a non-empty string from persisted data.
    expect(situationText).toBeTruthy();
    expect(typeof situationText).toBe("string");

    // Every action button has its dataset parameters populated.
    expect(chipProps.length).toBeGreaterThan(0);
    for (const p of chipProps) {
      expect(p.dc).toBeGreaterThan(0);
      // modStr must be a valid signed integer string usable as a data attribute.
      expect(p.modStr).toMatch(/^[+-]\d+$/);
    }
  });
});
