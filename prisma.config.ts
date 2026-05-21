// prisma.config.ts
import { config } from "dotenv";
import path from "path";

// FORCE Prisma CLI to read environment variables from .env.local
config({ path: path.resolve(process.cwd(), ".env.local") });

import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    // Prisma 7: seed command lives here, not in package.json
    seed: "node prisma/seed.mjs",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
