import { Link } from "react-router";

interface FooterLink {
  label: string;
  to: string;
}

const links: FooterLink[] = [
  { label: "Features", to: "#features" },
  { label: "Pricing", to: "#pricing" },
  { label: "Log In", to: "/login" },
  { label: "Contact", to: "/contact" },
  { label: "Privacy Policy", to: "/privacy" },
  { label: "Terms of Service", to: "/terms" },
];

export function LandingFooter() {
  return (
    <footer className="border-t border-dark-200 bg-dark-50 px-8 py-10">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6">
        {/* Logo */}
        <span className="font-display text-lg font-semibold text-white">
          Culin<span className="text-gold">AI</span>re Kitchen
        </span>

        {/* Links */}
        <nav className="flex flex-wrap items-center gap-5">
          {links.map((link) =>
            link.to.startsWith("#") ? (
              <a
                key={link.label}
                href={link.to}
                className="text-sm text-dark-500 transition-colors hover:text-dark-600"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.label}
                to={link.to}
                className="text-sm text-dark-500 transition-colors hover:text-dark-600"
              >
                {link.label}
              </Link>
            ),
          )}
        </nav>

        {/* Copyright */}
        <span className="text-sm text-dark-500">
          &copy; 2026 CulinAIre Kitchen &middot; www.culinaire.kitchen
        </span>
      </div>
    </footer>
  );
}
