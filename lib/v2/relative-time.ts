export function relativeTime(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0)  return 'Today';
  if (days === 1)  return 'Yesterday';
  if (days < 7)   return `${days} days ago`;
  if (days < 30)  { const w = Math.floor(days / 7); return `${w} week${w > 1 ? 's' : ''} ago`; }
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? 's' : ''} ago`;
}
