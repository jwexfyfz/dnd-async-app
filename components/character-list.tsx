"use client";

// Character data shape — must stay in sync with the Prisma Character model.
interface Character {
  id: string;
  name: string;
  characterClass: string;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

interface Props {
  // Characters are fetched in page.tsx and passed down here so that
  // creating a new character can trigger a refresh without this component
  // needing to know anything about data fetching.
  characters: Character[];
  loading: boolean;
}

export default function CharacterList({ characters, loading }: Props) {
  if (loading) return <p className="text-center text-sm text-slate-500 mt-8">Summoning your roster...</p>;

  if (characters.length === 0) {
    return (
      <div className="w-full max-w-2xl mx-auto text-center p-8 border border-dashed border-slate-200 rounded-xl mt-8">
        <p className="text-sm text-slate-500">No heroes have been forged yet in this realm.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto mt-10 space-y-4 text-slate-900">
      <h3 className="text-lg font-bold tracking-tight border-b border-slate-200 pb-2">Your Roster</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {characters.map((hero) => (
          <div key={hero.id} className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm hover:border-slate-300 transition-colors">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h4 className="font-semibold text-slate-900">{hero.name}</h4>
                <span className="inline-block text-xs font-semibold px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-full mt-1 text-slate-600">
                  {hero.characterClass}
                </span>
              </div>
            </div>
            {/* Attributes Layout Grid */}
            <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2 rounded-lg text-center text-xs">
              <div><div className="text-slate-500 font-medium">STR</div><div className="font-bold text-slate-800">{hero.strength}</div></div>
              <div><div className="text-slate-500 font-medium">DEX</div><div className="font-bold text-slate-800">{hero.dexterity}</div></div>
              <div><div className="text-slate-500 font-medium">CON</div><div className="font-bold text-slate-800">{hero.constitution}</div></div>
              <div><div className="text-slate-500 font-medium">INT</div><div className="font-bold text-slate-800">{hero.intelligence}</div></div>
              <div><div className="text-slate-500 font-medium">WIS</div><div className="font-bold text-slate-800">{hero.wisdom}</div></div>
              <div><div className="text-slate-500 font-medium">CHA</div><div className="font-bold text-slate-800">{hero.charisma}</div></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
