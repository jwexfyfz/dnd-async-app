"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import CharacterForm from "../components/character-form";
import CharacterList from "../components/character-list";
import LoginScreen from "../components/login-screen";

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // UN-HARDCODED: Reads clean environment variables. 
  // Works locally on localhost and dynamically adjusts when deployed to Vercel.
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    async function handleAuthLifecycle() {
      if (typeof window !== "undefined" && window.location.hash) {
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");

        if (accessToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || "",
          });

          if (!error && data.user) {
            setUser(data.user);
            window.history.replaceState(null, "", window.location.pathname);
            setLoading(false);
            return;
          }
        }
      }

      const { data: { user: currentUser } } = await supabase.auth.getUser();
      setUser(currentUser);
      setLoading(false);
    }

    handleAuthLifecycle();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  if (loading) {
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
      
      <CharacterForm />
      <CharacterList />
    </main>
  );
}
