<!-- import-rules: ~/.claude/RTK.md -->

## Anti-Loop Guardrails
- No broad grep — target specific directories.
- No speculative file reads — only files directly related to the active task.
- Stop and ask after 3 consecutive failures; don't auto-fix indefinitely.
- No redundant builds — only rebuild after an actual file change.

## Commands
- Dev: `npm run dev`
- Build: `npm run build`
- Test: `npm test`
- Lint: `npm run lint`
- Generate Prisma client: `npx prisma generate`
- DB migration: `npx prisma migrate dev` (schema changes only — confirm before running)

## Stack
Next.js 16 App Router · TypeScript · Tailwind · Supabase Auth (SSR) · Prisma 7 + Neon adapter · Anthropic SDK (claude-haiku-4-5)

## Hard Rules
- Never alter `prisma/schema.prisma` or run `prisma db push/migrate` unless the task explicitly requires it.
- Never suppress or comment out TypeScript/build errors — fix the root cause.
- Never let AI generate dice roll results — dice math is pure code only.
- Surgical edits only — don't reformat or refactor files outside the active task.
