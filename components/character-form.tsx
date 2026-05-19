"use client";

import { useState } from "react";
import { createCharacter } from "@/app/actions/create-character";

export default function CharacterForm() {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    // Simple validation block
    if (!name.trim()) {
      setStatus("error");
      setErrorMessage("Character name cannot be blank.");
      return;
    }

    setStatus("loading");
    setErrorMessage("");

    try {
      const formData = new FormData();
      formData.append("name", name);

      const result = await createCharacter(formData);

      if (result?.success) {
        setStatus("success");
        setName(""); // Clear the input on success
      } else {
        setStatus("error");
        setErrorMessage(result?.error || "Failed to create character.");
      }
    } catch (err) {
      setStatus("error");
      setErrorMessage("A network error occurred. Please try again.");
    }
  }

  return (
    <div className="w-full max-w-md mx-auto p-6 bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900 tracking-tight">
          Create Your Hero
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Every great adventure begins with a name.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label 
            htmlFor="character-name" 
            className="text-sm font-medium text-slate-700 block"
          >
            Character Name
          </label>
          <input
            id="character-name"
            type="text"
            placeholder="e.g., Lyra the Swift"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={status === "loading"}
            className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>

        {status === "error" && (
          <p className="text-sm font-medium text-red-600 bg-red-50 p-2.5 rounded-md">
            {errorMessage}
          </p>
        )}

        {status === "success" && (
          <p className="text-sm font-medium text-green-600 bg-green-50 p-2.5 rounded-md">
            Character forged successfully!
          </p>
        )}

        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full bg-slate-900 text-white text-sm font-medium h-10 px-4 py-2 rounded-md hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 disabled:bg-slate-400 transition-colors"
        >
          {status === "loading" ? "Forging..." : "Create Character"}
        </button>
      </form>
    </div>
  );
}
