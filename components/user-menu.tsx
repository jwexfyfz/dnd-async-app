"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "../lib/supabase-client";

export default function UserMenu() {
  const [user, setUser] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const ref  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabaseBrowser.auth.getUser().then(({ data: { user: u } }) => setUser(u));
    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Close dropdown when clicking outside.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!user) return null;

  const avatarUrl = user.user_metadata?.avatar_url as string | undefined;
  const name      = (user.user_metadata?.full_name as string) || user.email;
  const initials  = (name as string)?.charAt(0).toUpperCase() ?? "?";

  async function handleSignOut() {
    await supabaseBrowser.auth.signOut();
    window.location.href = "/";
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 rounded-full overflow-hidden border border-slate-200 shadow-sm hover:ring-2 hover:ring-slate-300 transition-all"
        aria-label="Account menu"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-slate-200 flex items-center justify-center text-xs font-semibold text-slate-600">
            {initials}
          </div>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[180px]">
          <p className="text-xs text-slate-400 px-3 py-2 truncate border-b border-slate-100">
            {user.email}
          </p>
          <button
            onClick={handleSignOut}
            className="w-full text-left text-sm px-3 py-2 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
