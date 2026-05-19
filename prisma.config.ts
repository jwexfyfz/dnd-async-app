// prisma.config.ts
import { config } from "dotenv";
import path from "path";

// FORCE Prisma CLI to read environment variables from .env.local
config({ path: path.resolve(process.cwd(), ".env.local") });

import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // This tells the CLI to use your Session mode / Pooler string on port 5432
    url: env("DIRECT_URL"),
  },
});
