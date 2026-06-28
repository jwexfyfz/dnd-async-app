'use client';

import type { CombatState, PartyMemberInfo, CombatAlertInfo, RemoteCombatInfo } from '@/types/v2-game';

export interface HistoryEntry {
  id: string;
  text: string;
  isMechanicalEvent: boolean;
  mechanicalSummary: Record<string, unknown> | null;
  createdAt: string;
  authorCharacterId?: string | null;
  authorCharacterClass?: string | null;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
}

export interface InitiativeRollEntry {
  id: string;
  name: string;
  type: 'character' | 'enemy';
  d20Roll: number;
  modifier: number;
  initiative: number;
}

export function buildBannerEntry(type: 'combat_start' | 'combat_end', cs?: CombatState | null): HistoryEntry {
  if (type === 'combat_end') {
    return {
      id: `banner-end-${Date.now()}`,
      text: '',
      isMechanicalEvent: true,
      mechanicalSummary: { type: 'combat_end' },
      createdAt: new Date().toISOString(),
    };
  }
  return {
    id: `banner-start-${Date.now()}`,
    text: '',
    isMechanicalEvent: true,
    mechanicalSummary: {
      type: 'combat_start',
      round: cs?.round ?? 1,
      activeActorId: cs?.activeActorId ?? '',
    },
    createdAt: new Date().toISOString(),
  };
}

export function CombatBanner({ type, round, initiativeRolls, activeActorId, characterId }: {
  type: 'combat_start' | 'combat_end';
  round?: number;
  initiativeRolls?: InitiativeRollEntry[];
  activeActorId?: string;
  characterId?: string;
}) {
  if (type === 'combat_end') {
    return (
      <div className="my-3 px-4 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500 text-center">
        Combat ended — all enemies defeated
      </div>
    );
  }

  return (
    <div className="my-3 rounded-lg border border-red-300 bg-red-50 overflow-hidden">
      <div className="px-4 py-2 border-b border-red-200">
        <span className="text-sm font-semibold text-red-700">⚔ Combat started — Initiative rolled</span>
      </div>
      {initiativeRolls && initiativeRolls.length > 0 && (
        <div className="px-4 py-2 space-y-1.5">
          {initiativeRolls.map((e, i) => {
            const isFirst = e.id === activeActorId;
            const isYou = e.id === characterId;
            const modStr = e.modifier > 0 ? `+${e.modifier}` : e.modifier < 0 ? `${e.modifier}` : '';
            return (
              <div key={e.id} className={`flex items-center justify-between text-xs rounded px-2 py-1 ${isFirst ? 'bg-red-100 border border-red-300' : 'bg-white border border-slate-100'}`}>
                <span className={`font-medium ${isFirst ? 'text-red-800' : e.type === 'enemy' ? 'text-slate-600' : 'text-indigo-700'}`}>
                  {i + 1}. {e.name}{isYou ? ' (you)' : ''}
                  {isFirst && <span className="ml-1.5 text-red-600 font-semibold">← goes first</span>}
                </span>
                <span className="flex items-center gap-1 text-slate-500 font-mono">
                  <span>{e.d20Roll}</span>
                  {modStr && <span className="text-slate-400">{modStr}</span>}
                  <span className="text-slate-300">=</span>
                  <span className="font-bold text-slate-700">{e.initiative}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function lastSeenText(d: Date | string | null | undefined): string {
  if (!d) return 'Never';
  const ms = Math.max(0, Date.now() - new Date(d).getTime());
  if (ms < 5 * 60 * 1000) return 'Online now';
  if (ms < 60 * 60 * 1000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 24 * 60 * 60 * 1000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)} day${Math.floor(ms / 86400000) === 1 ? '' : 's'} ago`;
}

export function ExplorationResumeCard({ roomName, partyMembers, situationSummary, lastDmMessage, onDismiss }: {
  roomName: string;
  partyMembers: PartyMemberInfo[];
  situationSummary?: string | null;
  lastDmMessage: string | null;
  onDismiss: () => void;
}) {
  const blurb = situationSummary || lastDmMessage;
  return (
    <div className="my-3 mx-1 rounded-lg border border-teal-200 bg-teal-50 overflow-hidden text-xs">
      <div className="px-3 py-2 bg-teal-100 border-b border-teal-200 font-medium text-teal-700">
        Exploring · {roomName}
      </div>
      {partyMembers.length > 0 && (
        <div className="px-3 py-2 space-y-1 border-b border-teal-100">
          {partyMembers.map(m => (
            <div key={m.characterId} className="flex items-center justify-between text-teal-700">
              <span className="font-medium">{m.characterName}{m.isDead ? ' †' : m.isDormant ? ' (away)' : ''}</span>
              <span className="text-teal-500">{lastSeenText(m.lastSeenAt)}</span>
            </div>
          ))}
        </div>
      )}
      {blurb && (
        <div className="px-3 py-2 border-b border-teal-100 text-teal-600 italic line-clamp-3">{blurb}</div>
      )}
      <div className="px-3 py-2 flex justify-center">
        <button onClick={onDismiss} className="text-teal-600 font-medium hover:text-teal-800 transition-colors">Resume Adventure →</button>
      </div>
    </div>
  );
}

export function CombatAlertResumeCard({ combatAlert, onDismiss }: {
  combatAlert: CombatAlertInfo;
  onDismiss: () => void;
}) {
  const names = combatAlert.fightingCharacters;
  const whoText = names.length > 0
    ? names.join(', ') + (names.length === 1 ? ' is fighting' : ' are fighting')
    : 'Combat is underway';
  return (
    <div className="my-3 mx-1 rounded-lg border border-red-200 bg-red-50 overflow-hidden text-xs">
      <div className="px-3 py-2 bg-red-100 border-b border-red-200 font-medium text-red-700">
        ⚔ Combat nearby — {combatAlert.roomName}
      </div>
      <div className="px-3 py-2 border-b border-red-100 text-red-800">
        {whoText} · Round {combatAlert.round}
      </div>
      <div className="px-3 py-2 flex justify-center">
        <button onClick={onDismiss} className="text-red-600 font-medium hover:text-red-800 transition-colors">Go to battle →</button>
      </div>
    </div>
  );
}

export function RemoteCombatBanner({ remoteCombat, isMyTurn }: {
  remoteCombat: RemoteCombatInfo;
  isMyTurn: boolean;
}) {
  const activeActor = remoteCombat.combatState.initiativeOrder.find(e => e.id === remoteCombat.combatState.activeActorId);

  if (isMyTurn) {
    return (
      <div className="flex items-center justify-between px-4 py-2 bg-red-600 text-white text-sm font-semibold flex-shrink-0">
        <span>⚔ Your turn — fighting at {remoteCombat.roomName}</span>
        <span className="text-xs bg-white/20 rounded-full px-2 py-0.5 font-bold tracking-wide">Round {remoteCombat.combatState.round}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-amber-100 border-b border-amber-200 text-amber-800 text-xs flex-shrink-0">
      <span>⚔ You&apos;re in combat at <span className="font-semibold">{remoteCombat.roomName}</span> · Round {remoteCombat.combatState.round}</span>
      {activeActor && <span className="text-amber-600">{activeActor.name}&apos;s turn</span>}
    </div>
  );
}

export function CombatResumeCard({ combatState, roomName, characterId, onDismiss }: {
  combatState: CombatState;
  roomName: string;
  characterId: string;
  onDismiss?: () => void;
}) {
  const living = combatState.initiativeOrder.filter(e => e.hp > 0);
  return (
    <div className="my-3 mx-1 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden text-xs">
      <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 font-medium text-slate-600">
        Combat resumed · Round {combatState.round} · {roomName}
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {living.map(e => {
          const isYou = e.id === characterId;
          const isActive = e.id === combatState.activeActorId;
          const acted = e.acted && !isActive;
          return (
            <div key={e.id} className="flex items-center justify-between text-slate-600">
              <span className="font-medium">{e.name}{isYou ? ' (you)' : ''}</span>
              <span className="flex items-center gap-2">
                <span className="text-slate-500">♥ {e.hp}/{e.maxHp}</span>
                <span className="text-slate-400">AC {e.ac}</span>
                {isActive && <span className="text-indigo-600 font-semibold">← your turn</span>}
                {acted && <span className="text-slate-400">(acted)</span>}
              </span>
            </div>
          );
        })}
      </div>
      <div className="px-3 py-1.5 border-t border-slate-200 text-center">
        {onDismiss
          ? <button onClick={onDismiss} className="text-indigo-600 font-medium hover:text-indigo-800 transition-colors">Resume →</button>
          : <span className="text-slate-400">Scroll up to see how this fight started.</span>
        }
      </div>
    </div>
  );
}
