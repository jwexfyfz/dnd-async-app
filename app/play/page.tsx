"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getStoryPrompts } from "../actions/get-story-prompts";
import { startGame } from "../actions/start-game";

interface StoryPrompt {
  id: string;
  title: string;
  description: string;
  difficulty: string;
}

// Difficulty badge colours match a simple traffic-light system.
const difficultyStyle: Record<string, string> = {
  Beginner: "bg-green-100 text-green-800 border-green-200",
  Standard: "bg-amber-100 text-amber-800 border-amber-200",
  Veteran:  "bg-red-100   text-red-800   border-red-200",
};

// The actual page content is a separate component so it can be wrapped in
// Suspense — required by Next.js when using useSearchParams in a client component.
function PlayContent() {
  const searchParams  = useSearchParams();
  const router        = useRouter();
  const characterId   = searchParams.get("characterId");

  const [prompts,  setPrompts]  = useState<StoryPrompt[]>([]);
  const [loading,  setLoading]  = useState(true);
  // Tracks which prompt card the user clicked so we can show a spinner on it.
  const [starting, setStarting] = useState<string | null>(null);
  const [error,    setError]    = useState("");

  useEffect(() => {
    // If no character was passed in the URL, go home rather than showing a
    // broken selection screen.
    if (!characterId) { router.replace("/"); return; }

    getStoryPrompts().then((res) => {
      if (res.success) setPrompts(res.data as StoryPrompt[]);
      setLoading(false);
    });
  }, [characterId, router]);

  async function handleSelect(promptId: string) {
    if (!characterId || starting) return;
    setStarting(promptId);
    setError("");

    const result = await startGame(characterId, promptId);

    if (result.success && result.gameId) {
      // Game created (or an existing active game found) — head straight in.
      // Send players to the lobby so they can invite others before starting.
      router.push(`/game/${result.gameId}/lobby`);
    } else {
      setError(result.error ?? "Failed to start adventure.");
      setStarting(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-500 animate-pulse">Consulting the archives...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-2xl mx-auto space-y-8">

        {/* Header */}
        <div>
          <Link href="/" className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
            ← Back to roster
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-3">Choose Your Adventure</h1>
          <p className="text-sm text-slate-500 mt-1">
            Pick a scenario to begin. Your progress is saved — come back any time.
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
        )}

        {/* Story prompt cards */}
        <div className="space-y-4">
          {prompts.map((prompt) => {
            const isStarting = starting === prompt.id;
            return (
              <button
                key={prompt.id}
                onClick={() => handleSelect(prompt.id)}
                disabled={!!starting}
                className="w-full text-left p-5 bg-white border border-slate-200 rounded-xl shadow-sm hover:border-slate-400 hover:shadow-md transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <div className="flex justify-between items-start gap-3 mb-2">
                  <h2 className="font-semibold text-slate-900">{prompt.title}</h2>
                  <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 border rounded-full ${difficultyStyle[prompt.difficulty] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
                    {prompt.difficulty}
                  </span>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">{prompt.description}</p>
                {isStarting && (
                  <p className="text-xs text-slate-400 mt-3 animate-pulse">Preparing the realm...</p>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
}

// Suspense boundary required because PlayContent uses useSearchParams.
export default function PlayPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-50 flex items-center justify-center">
          <p className="text-sm text-slate-500 animate-pulse">Consulting the archives...</p>
        </main>
      }
    >
      <PlayContent />
    </Suspense>
  );
}
