/**
 * @module hooks/usePersonalisationOptions
 *
 * Fetches active personalisation options from the API for use in
 * KitchenWizard and MyKitchenTab. Options are database-driven and
 * managed by admins via Settings → Personalisation.
 */

import { useState, useEffect } from "react";

export interface ProfileOption {
  optionId: number;
  optionType: string;
  optionValue: string;
  optionLabel: string;
  optionDescription: string | null;
  sortOrder: number;
  activeInd: boolean;
}

export interface PersonalisationOptions {
  skill_level: ProfileOption[];
  cuisine: ProfileOption[];
  dietary: ProfileOption[];
  equipment: ProfileOption[];
}

interface UsePersonalisationOptionsResult {
  options: PersonalisationOptions | null;
  loading: boolean;
  error: string | null;
}

export function usePersonalisationOptions(): UsePersonalisationOptionsResult {
  const [options, setOptions] = useState<PersonalisationOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/personalisation-options", {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: PersonalisationOptions = await res.json();
        if (!cancelled) setOptions(data);
      } catch (err) {
        if (!cancelled) {
          setError("Failed to load personalisation options.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return { options, loading, error };
}
