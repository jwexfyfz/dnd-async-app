"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import CharacterForm from "../../components/character-form";

// Separated so Suspense can wrap the useSearchParams call.
function CreateCharacterContent() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  // If the user arrived here from a lobby invite link, send them back after
  // creating their character so they can immediately join.
  const redirectTo   = searchParams.get("redirect") ?? "/";

  function handleCreated() {
    router.push(redirectTo);
  }

  const backHref = redirectTo === "/" ? "/" : redirectTo;

  return (
    <main className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        <div>
          <Link href={backHref} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
            ← Back
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-3">Forge a New Hero</h1>
          <p className="text-sm text-slate-500 mt-0.5">Build your character using the D&D 5e Point Buy system.</p>
          {redirectTo !== "/" && (
            <p className="text-xs text-slate-400 mt-2 bg-slate-100 rounded-lg px-3 py-2">
              After creating your character you'll be sent back to join the adventure.
            </p>
          )}
        </div>
        <CharacterForm onCharacterCreated={handleCreated} />
      </div>
    </main>
  );
}

export default function CreateCharacterPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-500 animate-pulse">Loading...</p>
      </main>
    }>
      <CreateCharacterContent />
    </Suspense>
  );
}
