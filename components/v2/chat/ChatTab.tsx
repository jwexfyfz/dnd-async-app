'use client';

import { useState } from 'react';
import type { CombatState, CharacterStats, CharacterInventory, PartyMemberInfo, ItemDefinition, CombatAlertInfo } from '@/types/v2-game';
import type { HistoryEntry } from '@/components/v2/combat/CombatBanner';
import { ExplorationResumeCard, CombatResumeCard, CombatAlertResumeCard } from '@/components/v2/combat/CombatBanner';
import { ItemPickerSheet } from '@/components/v2/inventory/InventoryTab';
import { ActionChips } from '@/components/v2/combat/ActionChips';
import { ChatMessage } from '@/components/v2/chat/ChatMessage';

export function ChatTab({ history, hasMore, loadingMore, loadMore, sending, error, input, setInput, sendAction, handleKeyDown, chip, setChip, gameState, combatState, characterStats, characterInventory, chatEndRef, chatContainerRef, showResumeCard, onDismissResume, roomName, characterId, partyMembers, onEndTurn, onFeatureActivate, situationSummary, combatAlert }: {
  history: HistoryEntry[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  sending: boolean;
  error: string;
  input: string;
  setInput: (v: string) => void;
  sendAction: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  chip: string | null;
  setChip: (v: string | null) => void;
  gameState: 'exploration' | 'combat';
  combatState: CombatState | null;
  characterStats: CharacterStats | null;
  characterInventory: CharacterInventory | null;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  showResumeCard: boolean;
  onDismissResume: () => void;
  roomName: string;
  characterId: string;
  partyMembers: PartyMemberInfo[];
  onEndTurn: () => void;
  onFeatureActivate?: (label: string) => void;
  situationSummary?: string | null;
  combatAlert?: CombatAlertInfo | null;
}) {
  const [showItemSheet, setShowItemSheet] = useState(false);

  const combatUsableItems = characterInventory?.bag.filter(i => i.combat_usable) ?? [];
  const partyTargets = combatState?.initiativeOrder
    .map(e => ({ id: e.id, name: e.name, hp: e.hp, maxHp: e.maxHp })) ?? [];

  function handleOpenItemSheet() {
    const items = characterInventory?.bag.filter(i => i.combat_usable) ?? [];
    const needsPicker = (i: ItemDefinition) => { const t = i.target ? (Array.isArray(i.target) ? i.target : [i.target]) : ['self']; return t.some(v => v === 'ally' || v === 'enemy'); };
    if (items.length === 1 && !needsPicker(items[0])) {
      setChip(`Use: ${items[0].name}`);
    } else {
      setShowItemSheet(true);
    }
  }

  return (
    <>
      {showItemSheet && (
        <ItemPickerSheet
          items={combatUsableItems}
          targets={partyTargets}
          onSelect={chip => { setChip(chip); setShowItemSheet(false); }}
          onDismiss={() => setShowItemSheet(false)}
        />
      )}
      <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-4 py-4">
        {hasMore && (
          <div className="flex justify-center mb-3">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="text-xs text-slate-400 hover:text-slate-600 disabled:opacity-40 px-3 py-1 border border-slate-200 rounded-full"
            >
              {loadingMore ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        )}
        {history.length === 0 && !sending && (
          <p className="text-center text-slate-400 text-sm mt-8">Loading…</p>
        )}
        {history.map(entry => (
          <ChatMessage key={entry.id} entry={entry} characterId={characterId} />
        ))}
        {showResumeCard && combatAlert && (
          <CombatAlertResumeCard combatAlert={combatAlert} onDismiss={onDismissResume} />
        )}
        {showResumeCard && !combatAlert && gameState === 'exploration' && (
          <ExplorationResumeCard
            roomName={roomName}
            partyMembers={partyMembers}
            situationSummary={situationSummary}
            lastDmMessage={history.filter(e => !e.mechanicalSummary || (e.mechanicalSummary as { type?: string }).type !== 'player_action').at(-1)?.text ?? null}
            onDismiss={onDismissResume}
          />
        )}
        {showResumeCard && !combatAlert && gameState === 'combat' && combatState && (
          <CombatResumeCard combatState={combatState} roomName={roomName} characterId={characterId} onDismiss={onDismissResume} />
        )}
        {sending && (
          <div className="flex justify-start my-2">
            <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl rounded-bl-sm text-sm text-slate-400 italic">
              The DM is writing…
            </div>
          </div>
        )}
        {error && (
          <p className="text-center text-red-500 text-xs my-2">{error}</p>
        )}
        <div ref={chatEndRef} />
      </div>

      {gameState === 'combat' && (
        <ActionChips
          characterStats={characterStats}
          characterInventory={characterInventory}
          combatState={combatState}
          chip={chip}
          setChip={setChip}
          onOpenItemSheet={handleOpenItemSheet}
          onEndTurn={onEndTurn}
          onFeatureActivate={onFeatureActivate}
        />
      )}

      <div className="px-4 pt-2 pb-3 bg-white border-t border-slate-200 flex-shrink-0">
        {(() => {
          const isDying = (characterStats?.currentHp ?? 1) <= 0;
          const isMyTurn = gameState !== 'combat' || !combatState || combatState.activeActorId === characterId;
          if (!isMyTurn) {
            const activeActor = combatState?.initiativeOrder.find(e => e.id === combatState.activeActorId);
            const actorName = activeActor?.name ?? 'Someone';
            return (
              <div className="flex items-center justify-center gap-2 py-3 px-4 bg-slate-100 rounded-xl text-slate-500 text-sm">
                <span className="animate-pulse">⏳</span>
                <span>Waiting for <span className="font-semibold text-slate-700">{actorName}</span>…</span>
              </div>
            );
          }
          if (isDying) {
            return (
              <div className="flex items-center justify-center gap-2 py-3 px-4 bg-red-50 border border-red-100 rounded-xl text-red-400 text-sm">
                <span>💀</span>
                <span>Unconscious — tap <span className="font-semibold text-red-600">Death Save</span> or End Turn</span>
              </div>
            );
          }
          if (chip) {
            return (
              <>
                <div className="flex mb-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-semibold">
                    {chip}
                    <button onClick={() => setChip(null)} className="text-indigo-400 hover:text-indigo-600 leading-none ml-0.5" aria-label="Remove chip">×</button>
                  </span>
                </div>
                {renderChatInput()}
              </>
            );
          }
          return renderChatInput();
          function renderChatInput() {
            const allActionsUsed = gameState === 'combat' &&
              (combatState?.currentTurnUsage.actionUsed ?? false) &&
              (combatState?.currentTurnUsage.bonusActionUsed ?? false) &&
              (combatState?.currentTurnUsage.movementUsed ?? false);
            return (
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={2}
                  placeholder={allActionsUsed ? 'All actions used — press End Turn' : 'What do you do? (Enter to send)'}
                  className={`flex-1 resize-none border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 ${allActionsUsed ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed' : 'border-slate-300'}`}
                  disabled={sending || allActionsUsed}
                />
                <button
                  onClick={sendAction}
                  disabled={sending || !input.trim() || allActionsUsed}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
                >
                  Send
                </button>
              </div>
            );
          }
        })()}
      </div>
    </>
  );
}
