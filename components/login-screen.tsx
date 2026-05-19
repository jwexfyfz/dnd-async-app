"use client";

import { useState } from "react";

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);

  function handleDynamicRoute() {
    setLoading(true);

    const domain = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const endpoint = "/auth/v1/authorize?provider=google&redirect_to=";
    
    // UN-HARDCODED: Automatically targets localhost during testing, 
    // and seamlessly switches to your real Vercel URL when live!
    const currentDomain = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
    const callback = encodeURIComponent(`${currentDomain}/auth/callback`);

    window.location.replace(`${domain}${endpoint}${callback}`);
  }

  return (
    <div className="w-full max-w-md mx-auto p-8 bg-white border border-slate-200 rounded-xl shadow-sm text-slate-900 text-center">
      <div className="mb-8">
        <h2 className="text-2xl font-bold tracking-tight">Adventure Awaits</h2>
        <p className="text-sm text-slate-500 mt-1">
          Sign in to resume your asynchronous campaign.
        </p>
      </div>

      <button
        onClick={handleDynamicRoute}
        disabled={loading}
        className="w-full h-11 px-4 border border-slate-300 rounded-md bg-white text-slate-700 hover:bg-slate-50 font-medium text-sm transition-colors flex items-center justify-center space-x-2 shadow-sm disabled:bg-slate-100 disabled:text-slate-400"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path fill="#EA4335" d="M12 5.04c1.64 0 3.12.56 4.28 1.67l3.2-3.2C17.52 1.58 14.96 1 12 1 7.35 1 3.4 3.65 1.51 7.5l3.86 3C6.28 7.55 8.91 5.04 12 5.04z"/>
          <path fill="#4285F4" d="M23.49 12.27c0-.81-.07-1.59-.2-2.34H12v4.43h6.44c-.28 1.47-1.11 2.71-2.36 3.55l3.66 2.84c2.14-1.98 3.39-4.89 3.39-8.48z"/>
          <path fill="#FBBC05" d="M5.37 14.77c-.24-.72-.37-1.49-.37-2.27s.13-1.55.37-2.27l-3.86-3C.68 8.78 0 10.31 0 12s.68 3.22 1.51 4.77l3.86-3z"/>
          <path fill="#34A853" d="M12 23c3.24 0 5.97-1.08 7.96-2.91l-3.66-2.84c-1.01.68-2.31 1.09-4.3 1.09-3.09 0-5.72-2.51-6.65-5.46L1.49 15.8C3.38 19.65 7.33 23 12 23z"/>
        </svg>
        <span>{loading ? "Routing..." : "Sign in with Google"}</span>
      </button>
    </div>
  );
}
