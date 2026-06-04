"use client";

import { useEffect } from "react";

export default function GameRouteLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const el = document.getElementById("global-user-menu");
    if (el) el.style.display = "none";
    return () => {
      if (el) el.style.display = "";
    };
  }, []);

  return <>{children}</>;
}
