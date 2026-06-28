// One-off data patch: add throw_damage_type and throw_effect to the Torch Bundle
// item already persisted in PoiTemplate.defaultProperties, PoiInstance.currentProperties
// (floor_items), and Character.inventory (bag/equipped). Mirrors the item definition
// updated in prisma/seed.mjs. Does NOT delete or reset any game data — only merges new
// fields onto matching item objects (matched by `id`).
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

config({ path: ".env.local" });

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const ITEM_PATCHES = {
  torch_bundle: {
    throw_damage_type: "fire",
    throw_effect: "ignite",
  },
};

// Recursively walks an object/array tree, merging ITEM_PATCHES fields onto any object
// whose `id` matches a patch key. Returns true if anything was changed.
function patchItem(node) {
  if (!node || typeof node !== "object") return false;
  let changed = false;

  if (typeof node.id === "string" && ITEM_PATCHES[node.id]) {
    const patch = ITEM_PATCHES[node.id];
    for (const [k, v] of Object.entries(patch)) {
      node[k] = v;
      changed = true;
    }
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (patchItem(entry)) changed = true;
      }
    } else if (value && typeof value === "object") {
      if (patchItem(value)) changed = true;
    }
  }

  return changed;
}

async function main() {
  console.log("Patching PoiTemplate.defaultProperties...");
  const templates = await prisma.poiTemplate.findMany({ select: { id: true, name: true, defaultProperties: true } });
  for (const t of templates) {
    const dp = JSON.parse(JSON.stringify(t.defaultProperties ?? {}));
    if (patchItem(dp)) {
      await prisma.poiTemplate.update({ where: { id: t.id }, data: { defaultProperties: dp } });
      console.log(`  patched template "${t.name}" (${t.id})`);
    }
  }

  console.log("Patching PoiInstance.currentProperties...");
  const instances = await prisma.poiInstance.findMany({ select: { id: true, currentProperties: true } });
  for (const inst of instances) {
    const cp = JSON.parse(JSON.stringify(inst.currentProperties ?? {}));
    if (patchItem(cp)) {
      await prisma.poiInstance.update({ where: { id: inst.id }, data: { currentProperties: cp } });
      console.log(`  patched instance ${inst.id}`);
    }
  }

  console.log("Patching Character.inventory...");
  const characters = await prisma.character.findMany({ select: { id: true, name: true, inventory: true } });
  for (const c of characters) {
    const inv = JSON.parse(JSON.stringify(c.inventory ?? {}));
    if (patchItem(inv)) {
      await prisma.character.update({ where: { id: c.id }, data: { inventory: inv } });
      console.log(`  patched character "${c.name}" (${c.id}) inventory`);
    }
  }

  console.log("Done.");
}

main()
  .catch(e => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
