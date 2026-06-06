'use client';

import { usePathname } from 'next/navigation';
import UserMenu from './user-menu';

export default function GlobalUserMenu() {
  const pathname = usePathname();
  if (pathname.startsWith('/v2')) return null;
  return <UserMenu />;
}
