"use client";

import { useState } from "react";
import { createCharacter } from "@/app/actions/create-character";

// The four classes available in this campaign. Add more here to extend the picker.
const CLASSES = ["Fighter", "Wizard", "Rogue", "Cleric"];

// D&D 5e Point Buy rule: every stat starts at 8, the minimum allowed value.
const INITIAL_STATS = { strength: 8, dexterity: 8, constitution: 8, intelligence: 8, wisdom: 8, charisma: 8 };

interface Props {
  // Called by the parent (page.tsx) after a successful save so it can
  // immediately refresh the character roster without a full page reload.
  onCharacterCreated: () => void;
}

export default function CharacterForm({ onCharacterCreated }: Props) {
  const [name, setName] = useState("");
  const [selectedClass, setSelectedClass] = useState("");
  const [stats, setStats] = useState(INITIAL_STATS);
  const [pointsLeft, setPointsLeft] = useState(27); 
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [ruleHint, setRuleHint] = useState(""); // Holds explanation messages for the user

  // Helper to figure out the cost of moving to the next level
  function getStatCost(currentValue: number, isIncrementing: boolean) {
    if (isIncrementing) {
      // Moving up from 13->14 or 14->15 costs 2 points instead of 1
      return currentValue >= 13 ? 2 : 1;
    } else {
      // Moving down from 15->14 or 14->13 refunds 2 points instead of 1
      return currentValue >= 14 ? 2 : 1;
    }
  }

  function handleStatChange(stat: keyof typeof INITIAL_STATS, increment: boolean) {
    const currentValue = stats[stat];
    setRuleHint(""); // Clear any old hints

    if (increment) {
      if (currentValue >= 15) {
        setRuleHint(`Cannot increase ${stat} above 15. D&D 5e Point-Buy limits base stats to 15 before racial bonuses.`);
        return;
      }
      
      const cost = getStatCost(currentValue, true);
      if (pointsLeft < cost) {
        setRuleHint(`Not enough points! Increasing this stat to ${currentValue + 1} requires ${cost} points from your pool.`);
        return;
      }

      setStats({ ...stats, [stat]: currentValue + 1 });
      setPointsLeft(pointsLeft - cost);
      if (currentValue >= 13) {
        setRuleHint(`Elite tier reached: Raising a attribute to 14 or 15 costs 2 points per level.`);
      }
    } else {
      if (currentValue <= 8) {
        setRuleHint(`Cannot decrease ${stat} below 8. 8 is the absolute minimum base score allowed.`);
        return;
      }

      const refund = getStatCost(currentValue, false);
      setStats({ ...stats, [stat]: currentValue - 1 });
      setPointsLeft(pointsLeft + refund);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return (setStatus("error"), setErrorMessage("Character name cannot be blank."));
    if (!selectedClass) return (setStatus("error"), setErrorMessage("Please choose a class."));

    setStatus("loading");
    setErrorMessage("");
    setRuleHint("");

    try {
      const formData = new FormData();
      formData.append("name", name);
      formData.append("class", selectedClass);
      Object.entries(stats).forEach(([key, val]) => formData.append(key, val.toString()));

      const result = await createCharacter(formData);
      if (result?.success) {
        setStatus("success");
        setName("");
        setSelectedClass("");
        setStats(INITIAL_STATS);
        setPointsLeft(27);
        // Notify the parent so it can re-fetch the roster immediately.
        onCharacterCreated();
      } else {
        setStatus("error");
        setErrorMessage(result?.error || "Failed to create character.");
      }
    } catch (err) {
      setStatus("error");
      setErrorMessage("Network error. Try again.");
    }
  }

  return (
    <div className="w-full max-w-lg mx-auto p-6 bg-white border border-slate-200 rounded-xl shadow-sm text-slate-900">
      <h2 className="text-xl font-bold tracking-tight">Forge Your Hero</h2>
      <p className="text-sm text-slate-500 mb-6">Choose your path and assign your attributes.</p>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Name Input */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Character Name</label>
          <input
            type="text"
            placeholder="e.g., Lyra the Swift"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-slate-900 focus:outline-none"
          />
        </div>

        {/* Class Grid */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Choose Class</label>
          <div className="grid grid-cols-2 gap-2">
            {CLASSES.map((cls) => (
              <button
                key={cls}
                type="button"
                onClick={() => setSelectedClass(cls)}
                className={`p-3 border text-sm font-medium rounded-md transition-colors ${
                  selectedClass === cls ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                {cls}
              </button>
            ))}
          </div>
        </div>

        {/* Attribute Selector */}
        <div className="space-y-3 bg-slate-50 p-4 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-semibold text-slate-700">Attributes</span>
            <span className="text-xs bg-slate-200 px-2 py-1 rounded-full font-bold">
              {pointsLeft} Points Remaining
            </span>
          </div>

          {Object.keys(INITIAL_STATS).map((statKey) => {
            const key = statKey as keyof typeof INITIAL_STATS;
            return (
              <div key={key} className="flex justify-between items-center">
                <span className="text-sm capitalize font-medium text-slate-600">{key}</span>
                <div className="flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={() => handleStatChange(key, false)}
                    className="w-8 h-8 flex items-center justify-center bg-white border border-slate-300 rounded hover:bg-slate-100 font-bold"
                  >
                    -
                  </button>
                  <span className="w-6 text-center font-semibold text-sm">{stats[key]}</span>
                  <button
                    type="button"
                    onClick={() => handleStatChange(key, true)}
                    className="w-8 h-8 flex items-center justify-center bg-white border border-slate-300 rounded hover:bg-slate-100 font-bold"
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Dynamic Rules Engine Feedback Card */}
        {ruleHint && (
          <div className="text-xs font-medium text-amber-800 bg-amber-50 p-3 rounded-md border border-amber-200 transition-all">
            ℹ️ {ruleHint}
          </div>
        )}

        {status === "error" && <p className="text-sm font-medium text-red-600 bg-red-50 p-2.5 rounded-md">{errorMessage}</p>}
        {status === "success" && <p className="text-sm font-medium text-green-600 bg-green-50 p-2.5 rounded-md">Character forged successfully!</p>}

        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full bg-slate-900 text-white text-sm font-medium h-10 rounded-md hover:bg-slate-800 disabled:bg-slate-400 transition-colors"
        >
          {status === "loading" ? "Forging..." : "Save Character"}
        </button>
      </form>
    </div>
  );
}
