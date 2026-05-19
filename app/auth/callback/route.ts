import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  
  // Cleanly route the request directly to the homepage root pass.
  // This preserves your '#access_token=' string in the browser window bar,
  // allowing the inline script in app/page.tsx to capture it safely.
  return NextResponse.redirect(`${origin}/`);
}
