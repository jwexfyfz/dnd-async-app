---
phase: 4
slug: skills-abilities-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-23
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.7 |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npm run test:run -- lib/skills.test.ts` |
| **Full suite command** | `npm run test:run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:run -- lib/skills.test.ts`
- **After every plan wave:** Run `npm run test:run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 04-01 | 1 | SKILL-01 | T-04-01-01 | Schema migration creates skillProficiencies TEXT[] with default [] | migration | `npx prisma migrate status` | ❌ W0 | ⬜ pending |
| 04-01-02 | 04-01 | 1 | SKILL-02 | T-04-01-02 | Server-side validation rejects skills outside class allowed list | build | `npm run build 2>&1 \| tail -5` | ❌ W0 | ⬜ pending |
| 04-02-01 | 04-02 | 1 | SKILL-05 | T-04-02-01 | CLASS_FEATURES hardcoded map removed from page.tsx | build | `npm run build 2>&1 \| grep -c "error TS" \| grep -q "^0$"` | ✅ | ⬜ pending |
| 04-02-02 | 04-02 | 1 | SKILL-05 | T-04-02-02 | getClassFeatures returns features for character class/level | build | `npm run build 2>&1 \| tail -5` | ❌ W0 | ⬜ pending |
| 04-03-01 | 04-03 | 1 | SKILL-03, SKILL-05 | T-04-03-01 | resolveSkillCheck proficient: total = roll+modifier+profBonus | unit | `npm run test:run -- lib/skills.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-02 | 04-03 | 1 | SKILL-03, SKILL-05 | T-04-03-02 | resolveSkillCheck non-proficient: total = roll+modifier only | unit | `npm run test:run -- lib/skills.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-03 | 04-03 | 1 | SKILL-03, SKILL-05 | T-04-03-03 | All 18 skill-to-ability mappings correct | unit | `npm run test:run -- lib/skills.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-04 | 04-03 | 1 | SKILL-05 | T-04-03-04 | DC boundary: total === dc → success | unit | `npm run test:run -- lib/skills.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-05 | 04-03 | 1 | SKILL-05 | T-04-03-05 | DC boundary: total === dc-1 → failure | unit | `npm run test:run -- lib/skills.test.ts` | ❌ W0 | ⬜ pending |
| 04-04-01 | 04-04 | 2 | SKILL-04 | T-04-04-02 | Claude narration prompt does not contain raw roll numbers | build | `npm run build 2>&1 \| tail -5` | ✅ | ⬜ pending |
| 04-04-02 | 04-04 | 2 | SKILL-04 | T-04-04-01 | SkillCheckCard renders on skill check turns; DiceCard suppressed | build | `npm run build 2>&1 \| tail -5` | ❌ W0 | ⬜ pending |
| 04-05-01 | 04-05 | 2 | SKILL-01, SKILL-03 | T-04-05-01 | SKILL_PROFS hardcoded fallback removed; live DB data wired | build | `npm run build 2>&1 \| tail -5` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `lib/skills.ts` — pure module must exist before tests can run (created by 04-03)
- [ ] `lib/skills.test.ts` — covers SKILL-03 and SKILL-05: 18 skill mappings, proficient/non-proficient, DC boundary conditions (created by 04-03)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Character creation skill-pick UI: class-gated multi-select, correct pick count enforced | SKILL-02 | Browser UI interaction | Create a Fighter character; verify exactly 2 skills can be selected from the 8-skill pool; verify submit with 3 picks is rejected. Repeat for Rogue (4 picks from 11), Cleric (2 from 5), Wizard (2 from 6). |
| In-game skill check: SkillCheckCard visible, narration describes outcome without raw numbers | SKILL-04 | Claude narration is a live API call | Play a turn that triggers a Stealth check; confirm SkillCheckCard appears with skill name + outcome; confirm narration describes the result without mentioning "17" or "DC 12". |
| Abilities sub-tab: "New" badge on newly-unlocked features on level-up | SKILL-05 | Requires DB state change | Create a character at level 2; view Abilities sub-tab; confirm features for levels 1-2 shown; level character to 3 and confirm "New" badge on level-3 features. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
