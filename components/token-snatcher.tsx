"use client";

import { useEffect } from "react";

export default function TokenSnatcher() {
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      const hash = window.location.hash.substring(1);
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (accessToken) {
        console.log("🔍 CLIENT-SIDE AUDIT: Token extracted successfully!");
        console.log("Access Token snippet:", accessToken.substring(0, 15) + "...");
        
        const maxAge = 60 * 60 * 24 * 7; // 1 week
        const sessionMatrix = [accessToken, refreshToken || "", null, null, null];
        const encodedValue = encodeURIComponent(JSON.stringify(sessionMatrix));
        
        const cookieName = "sb-onuwvzrognhkrjcvusbo-auth-token";
        document.cookie = `${cookieName}=${encodedValue}; path=/; max-age=${maxAge}; SameSite=Lax; Secure`;

        console.log("✅ CLIENT-SIDE AUDIT: Cookie written to document.cookie. Verifying write...");
        console.log("Does document.cookie contain our target key?:", document.cookie.includes(cookieName));
        
        // Force the hard reload
        window.location.href = window.location.origin + window.location.pathname;
      }
    }
  }, []);

  return null;
}
