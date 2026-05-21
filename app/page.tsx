"use client";

import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "../lib/supabase-client";
import { getCharacters } from "./actions/get-characters";
import CharacterList from "../components/character-list";
import LoginScreen from "../components/login-screen";

// Shape returned by get-characters — includes enough game/party data to
// render the full campaign status on each character card.
interface ActiveGame {
  id:                     string;
  updatedAt:              string;
  phase:                  string;
  currentTurnCharacterId: string | null;
  storyPrompt:            { title: string };
  partyMembers:           Array<{
    characterId: string;
    turnOrder:   number;
    character:   { id: string; name: string; characterClass: string };
  }>;
}

interface Character {
  id:             string;
  name:           string;
  characterClass: string;
  strength:       number;
  dexterity:      number;
  constitution:   number;
  intelligence:   number;
  wisdom:         number;
  charisma:       number;
  games:            ActiveGame[];
  partyMemberships: Array<{ game: ActiveGame }>;
}

export default function Home() {
  const [user,             setUser]             = useState<any>(null);
  const [authLoading,      setAuthLoading]      = useState(true);
  const [characters,       setCharacters]       = useState<Character[]>([]);
  const [charactersLoading, setCharactersLoading] = useState(false);

  const loadCharacters = useCallback(async () => {
    setCharactersLoading(true);
    const res = await getCharacters();
    if (res.success && res.data) setCharacters(res.data as Character[]);
    setCharactersLoading(false);
  }, []);

  useEffect(() => {
    async function handleAuthLifecycle() {
      // After a Google OAuth redirect, session tokens arrive in the URL hash.
      // Extract them and hand off to Supabase so it can persist the session.
      if (typeof window !== "undefined" && window.location.hash) {
        const hash   = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const accessToken  = params.get("access_token");
        const refreshToken = params.get("refresh_token");

        if (accessToken) {
          const { data, error } = await supabaseBrowser.auth.setSession({
            access_token:  accessToken,
            refresh_token: refreshToken || "",
          });

          if (!error && data.user) {
            setUser(data.user);
            window.history.replaceState(null, "", window.location.pathname);
            setAuthLoading(false);
            // If the user clicked a lobby invite link before signing in,
            // send them back there now that auth is complete.
            const returnTo = sessionStorage.getItem("auth-return-to");
            if (returnTo) {
              sessionStorage.removeItem("auth-return-to");
              window.location.href = returnTo;
            }
            return;
          }
        }
      }

      const { data: { user: currentUser } } = await supabaseBrowser.auth.getUser();
      setUser(currentUser);
      setAuthLoading(false);
    }

    handleAuthLifecycle();

    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    return () => { subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (user) loadCharacters();
    else       setCharacters([]);
  }, [user, loadCharacters]);

  if (authLoading) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <p className="text-sm text-slate-500 font-medium animate-pulse">Checking adventurer coordinates...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <LoginScreen />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Your Heroes</h1>
          <p className="text-sm text-slate-500 mt-0.5">{user.email}</p>
        </div>
        <CharacterList characters={characters} loading={charactersLoading} onDeleted={loadCharacters} />
      </div>
    </main>
  );
}
