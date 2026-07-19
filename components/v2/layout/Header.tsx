'use client';

export type ActiveTab = 'chat' | 'inventory' | 'party' | 'map' | 'guardian';

export function Header({ roomName, gameState, round, hp, maxHp }: {
  roomName: string;
  gameState: 'exploration' | 'combat';
  round?: number;
  hp?: number;
  maxHp?: number;
}) {
  const isCombat = gameState === 'combat';
  const hpColor = (hp != null && maxHp != null && maxHp > 0)
    ? hp / maxHp > 0.6 ? 'text-white' : hp / maxHp > 0.3 ? 'text-yellow-200' : 'text-red-200'
    : 'text-white';
  return (
    <div className={`flex items-center justify-between px-4 py-3 flex-shrink-0 ${isCombat ? 'bg-red-600' : 'bg-blue-600'} text-white`}>
      <span className="font-semibold text-sm truncate max-w-[40%]">{roomName || 'Loading…'}</span>
      {isCombat && (
        <span className="px-2 py-0.5 text-xs font-bold bg-white/20 rounded-full tracking-wide">
          Round {round ?? '—'}
        </span>
      )}
      {hp != null && maxHp != null && (
        <span className={`text-sm font-semibold ${hpColor}`}>♥ {hp}/{maxHp}</span>
      )}
    </div>
  );
}

export function BottomNav({ activeTab, onTabChange, hasPendingChoice, hasPendingPulls }: {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  hasPendingChoice?: boolean;
  hasPendingPulls?: boolean;
}) {
  const tabs: { id: ActiveTab; label: string }[] = [
    { id: 'chat', label: 'Chat' },
    { id: 'inventory', label: 'Bag' },
    { id: 'party', label: 'Party' },
    { id: 'map', label: 'Map' },
    { id: 'guardian', label: 'Guardian' },
  ];
  return (
    <div className="flex border-t border-slate-200 bg-white flex-shrink-0">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onTabChange(t.id)}
          className={`flex-1 py-3 text-xs font-medium transition-colors relative ${
            activeTab === t.id
              ? 'text-indigo-600 border-t-2 border-indigo-600 -mt-px font-bold'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          {t.label}
          {t.id === 'party' && hasPendingChoice && (
            <span className="absolute top-2 right-[calc(50%-14px)] w-2 h-2 rounded-full bg-amber-400" />
          )}
          {t.id === 'guardian' && hasPendingPulls && (
            <span className="absolute top-2 right-[calc(50%-14px)] w-2 h-2 rounded-full bg-indigo-500" />
          )}
        </button>
      ))}
    </div>
  );
}
