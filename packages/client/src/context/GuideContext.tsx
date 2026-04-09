/**
 * @module context/GuideContext
 *
 * Lightweight context that lets any page override the guide key
 * used by GuideSidebar. This allows tab-based pages (like Inventory)
 * to control which guide is shown without changing routes.
 */

import { createContext, useContext, useState, type ReactNode } from "react";

interface GuideContextValue {
  guideKeyOverride: string | null;
  setGuideKeyOverride: (key: string | null) => void;
}

const GuideContext = createContext<GuideContextValue>({
  guideKeyOverride: null,
  setGuideKeyOverride: () => {},
});

export function GuideProvider({ children }: { children: ReactNode }) {
  const [guideKeyOverride, setGuideKeyOverride] = useState<string | null>(null);
  return (
    <GuideContext.Provider value={{ guideKeyOverride, setGuideKeyOverride }}>
      {children}
    </GuideContext.Provider>
  );
}

export function useGuide() {
  return useContext(GuideContext);
}
