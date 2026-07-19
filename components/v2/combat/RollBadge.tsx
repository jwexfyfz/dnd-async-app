'use client';

export interface RollResult {
  item: string;
  skill: string;
  d20: number;
  modifier: number;
  total: number;
  dc: number;
  success: boolean;
  poi?: string;
}

export interface CombatRollData {
  action: string;
  d20: number;
  modifier: number;
  total: number;
  vsTarget: string;
  success: boolean;
  isCrit?: boolean;
  damageRoll?: { dice: string; expr: string; total: number };
  rollMode?: 'advantage' | 'disadvantage';
  d20Rolls?: [number, number];
}

export function RollBadge({ rolls }: { rolls: RollResult[] }) {
  return (
    <div className="my-2 flex flex-col gap-1">
      {rolls.map((r, i) => (
        <div
          key={i}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono w-fit border ${
            r.success
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-slate-50 border-slate-200 text-slate-500'
          }`}
        >
          <span>🎲</span>
          <span className="capitalize">{r.skill}</span>
          <span className="font-bold">
            {r.d20}{r.modifier !== 0 ? (r.modifier > 0 ? `+${r.modifier}` : r.modifier) : ''}={r.total}
          </span>
          {r.poi && <span className="text-slate-400">@ {r.poi}</span>}
          <span className={r.success ? 'text-emerald-600 font-semibold' : 'text-slate-400'}>
            {r.success ? `✓ ${r.item}` : '✗ nothing'}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CombatRollBadge({ data, suppressDamage }: { data: CombatRollData; suppressDamage?: boolean }) {
  const modStr = data.modifier !== 0 ? (data.modifier > 0 ? `+${data.modifier}` : `${data.modifier}`) : '';
  return (
    <div className="my-2 flex flex-col gap-1.5">
      {/* Attack roll chip */}
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono w-fit border ${
        data.isCrit
          ? 'bg-amber-50 border-amber-300 text-amber-800'
          : data.success
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : 'bg-slate-50 border-slate-200 text-slate-500'
      }`}>
        <span>🎲</span>
        <span className="font-semibold">{data.action}</span>
        <span className="text-slate-400 font-normal">
          d20{modStr}{data.rollMode ? ` (${data.rollMode === 'advantage' ? 'adv' : 'dis'})` : ''}
        </span>
        <span className="text-slate-400">→</span>
        <span className="font-bold">
          {data.d20Rolls ? `[${data.d20Rolls.join(', ')}]` : data.d20}{modStr} = {data.total}
        </span>
        <span className="text-slate-400">vs {data.vsTarget}</span>
        <span className={data.success ? (data.isCrit ? 'text-amber-600 font-bold' : 'text-emerald-600 font-semibold') : 'text-slate-400'}>
          {data.isCrit ? '✓ CRIT' : data.success ? '✓ HIT' : '✗ MISS'}
        </span>
      </div>
      {/* Damage roll chip */}
      {!suppressDamage && data.success && data.damageRoll && (
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono w-fit border ${
          data.isCrit ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-orange-50 border-orange-200 text-orange-800'
        }`}>
          <span>⚔️</span>
          <span className="text-slate-400 font-normal">{data.damageRoll.dice}</span>
          <span className="text-slate-400">→</span>
          <span className="font-bold">{data.damageRoll.expr} = {data.damageRoll.total}</span>
          <span className="font-semibold">dmg</span>
        </div>
      )}
    </div>
  );
}
