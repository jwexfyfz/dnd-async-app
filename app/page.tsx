"use client";

import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "../lib/supabase-client";
import { getCharacters } from "./actions/get-characters";
import CharacterForm from "../components/character-form";
import CharacterList from "../components/character-list";
import LoginScreen from "../components/login-screen";

// Mirrors the shape of a Character row returned from the database.
interface Character {
  id: string;
  name: string;
  characterClass: string;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [charactersLoading, setCharactersLoading] = useState(false);

  // Fetches the current user's roster from the database and stores it here
  // in the parent so both CharacterForm and CharacterList share the same state.
  // useCallback gives this a stable reference so it's safe to pass as a prop.
  const loadCharacters = useCallback(async () => {
    setCharactersLoading(true);
    const res = await getCharacters();
    if (res.success && res.data) {
      setCharacters(res.data as Character[]);
    }
    setCharactersLoading(false);
  }, []);

  useEffect(() => {
    async function handleAuthLifecycle() {
      // After a Google OAuth redirect, Supabase puts the session tokens in the
      // URL hash (e.g. /#access_token=...). We extract them and hand them to
      // Supabase so it can write the session to cookies for future server calls.
      if (typeof window !== "undefined" && window.location.hash) {
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");

        if (accessToken) {
          const { data, error } = await supabaseBrowser.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || "",
          });

          if (!error && data.user) {
            setUser(data.user);
            // Strip the tokens from the URL so they don't linger in browser history.
            window.history.replaceState(null, "", window.location.pathname);
            setAuthLoading(false);
            return;
          }
        }
      }

      // On a normal page load (no hash tokens), check for an existing session.
      const { data: { user: currentUser } } = await supabaseBrowser.auth.getUser();
      setUser(currentUser);
      setAuthLoading(false);
    }

    handleAuthLifecycle();

    // Keep auth state in sync with any changes (token refresh, sign-out from
    // another tab, etc.) without requiring a full page reload.
    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Once we know who the user is, load their characters.
  // This effect re-runs if the user signs in or out.
  useEffect(() => {
    if (user) {
      loadCharacters();
    } else {
      setCharacters([]);
    }
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
    <main className="min-h-screen bg-slate-50 py-12 px-4 space-y-8 flex flex-col items-center">
      <div className="w-full max-w-lg mx-auto text-center p-4 bg-slate-100 border border-slate-200 rounded-lg text-slate-700 text-sm shadow-sm">
        🧙‍♂️ Adventurer Profile: <span className="font-semibold text-slate-900">{user.email}</span>
      </div>

      {/* Pass loadCharacters as a callback so CharacterForm can trigger a
          roster refresh immediately after a new character is saved. */}
      <CharacterForm onCharacterCreated={loadCharacters} />
      <CharacterList characters={characters} loading={charactersLoading} />
    </main>
  );
}
