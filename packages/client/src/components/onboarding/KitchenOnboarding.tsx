/**
 * @module components/onboarding/KitchenOnboarding
 *
 * Top-level onboarding orchestrator. Shown once to newly registered
 * (non-guest) users when their kitchen_profile.onboarding_done_ind is false.
 * Disappears permanently after the user completes or skips the wizard.
 */

import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext.js";
import { KitchenWizard } from "./KitchenWizard.js";

interface KitchenProfile {
  onboardingDoneInd: boolean;
}

export function KitchenOnboarding() {
  const { isAuthenticated, isGuest } = useAuth();
  const [showWizard, setShowWizard] = useState(false);
  const [checked, setChecked] = useState(false);

  // Fetch the kitchen profile once for authenticated (non-guest) users
  useEffect(() => {
    if (!isAuthenticated || isGuest || checked) return;

    async function checkOnboarding() {
      try {
        const res = await fetch("/api/users/kitchen-profile", { credentials: "include" });
        if (!res.ok) return;
        const profile = (await res.json()) as KitchenProfile;
        if (!profile.onboardingDoneInd) {
          setShowWizard(true);
        }
      } catch {
        // Non-fatal — wizard is optional
      } finally {
        setChecked(true);
      }
    }

    checkOnboarding();
  }, [isAuthenticated, isGuest, checked]);

  async function handleComplete(data: {
    skillLevel: string;
    cuisinePreferences: string[];
    dietaryRestrictions: string[];
    kitchenEquipment: string[];
  }) {
    try {
      await fetch("/api/users/kitchen-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...data, onboardingDoneInd: true }),
      });
    } catch {
      // Non-fatal
    } finally {
      setShowWizard(false);
    }
  }

  async function handleSkip() {
    // Mark onboarding done so the wizard doesn't reappear
    try {
      await fetch("/api/users/kitchen-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ onboardingDoneInd: true }),
      });
    } catch {
      // Non-fatal
    } finally {
      setShowWizard(false);
    }
  }

  if (!showWizard) return null;

  return <KitchenWizard onComplete={handleComplete} onSkip={handleSkip} />;
}
