import { useEffect } from "react";
import { LandingNav } from "../components/landing/LandingNav.js";
import { Hero } from "../components/landing/Hero.js";
import { TrustStrip } from "../components/landing/TrustStrip.js";
import { ProblemStatement } from "../components/landing/ProblemStatement.js";
import { ObjectionCards } from "../components/landing/ObjectionCards.js";
import { DayInTheLife } from "../components/landing/DayInTheLife.js";
import { FeatureShowcase } from "../components/landing/FeatureShowcase.js";
import { MobileCallout } from "../components/landing/MobileCallout.js";
import { MultiLocation } from "../components/landing/MultiLocation.js";
import { GMSection } from "../components/landing/GMSection.js";
import { Pricing } from "../components/landing/Pricing.js";
import { FinalCTA } from "../components/landing/FinalCTA.js";
import { LandingFooter } from "../components/landing/LandingFooter.js";

/**
 * Dynamically loads Cormorant Garamond + DM Sans only when the landing
 * page mounts, so these fonts don't penalise app bundle for other routes.
 */
function useLandingFonts() {
  useEffect(() => {
    const id = "landing-fonts";
    if (document.getElementById(id)) return;

    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap";
    document.head.appendChild(link);
  }, []);
}

export default function LandingPage() {
  useLandingFonts();

  return (
    <div className="font-landing bg-dark text-white min-h-screen overflow-x-hidden">
      <LandingNav />
      <Hero />
      <TrustStrip />
      <ProblemStatement />
      <ObjectionCards />
      <DayInTheLife />
      <FeatureShowcase />
      <MobileCallout />
      <MultiLocation />
      <GMSection />
      <Pricing />
      <FinalCTA />
      <LandingFooter />
    </div>
  );
}
