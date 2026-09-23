import { useState } from "react";
import { Link } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/AuthContext.js";

export function LandingNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { isAuthenticated, isGuest } = useAuth();
  const showDashboard = isAuthenticated && !isGuest;

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between bg-cocoa/85 backdrop-blur-xl border-b border-cocoa-200">
      {/* Logo */}
      <a href="#" className="font-display text-xl font-semibold text-white tracking-wide">
        Culin<span className="text-copper">AI</span>re Kitchen
      </a>

      {/* Desktop links */}
      <ul className="hidden md:flex items-center gap-8 list-none">
        <li>
          <Link
            to="/login"
            className="text-cocoa-600 text-sm border border-cocoa-200 rounded-md px-4 py-2 hover:border-copper hover:text-copper transition-colors"
          >
            Log In
          </Link>
        </li>
        <li>
          <Link
            to={showDashboard ? "/chat/new" : "/register"}
            className="bg-copper text-cocoa text-sm font-medium rounded-md px-4 py-2 hover:bg-copper-hover hover:translate-y-[-1px] transition-all"
          >
            {showDashboard ? "Go to Dashboard" : "Start Free Trial"}
          </Link>
        </li>
      </ul>

      {/* Hamburger */}
      <button
        className="flex md:hidden flex-col gap-[5px] p-1 bg-transparent border-none cursor-pointer"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label="Menu"
      >
        <motion.span
          className="block w-[22px] h-[1.5px] bg-cocoa-600"
          animate={menuOpen ? { rotate: 45, y: 6.5 } : { rotate: 0, y: 0 }}
        />
        <motion.span
          className="block w-[22px] h-[1.5px] bg-cocoa-600"
          animate={menuOpen ? { opacity: 0 } : { opacity: 1 }}
        />
        <motion.span
          className="block w-[22px] h-[1.5px] bg-cocoa-600"
          animate={menuOpen ? { rotate: -45, y: -6.5 } : { rotate: 0, y: 0 }}
        />
      </button>

      {/* Mobile menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="fixed top-[64px] left-0 right-0 bg-cocoa/98 backdrop-blur-xl border-b border-cocoa-200 p-6 flex flex-col gap-4 md:hidden"
          >
            <Link
              to="/login"
              className="text-cocoa-600 text-sm border border-cocoa-200 rounded-md px-4 py-2 text-center hover:border-copper hover:text-copper transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              Log In
            </Link>
            <Link
              to={showDashboard ? "/chat/new" : "/register"}
              className="bg-copper text-cocoa text-sm font-medium rounded-md px-4 py-2 text-center hover:bg-copper-hover transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              {showDashboard ? "Go to Dashboard" : "Start Free Trial"}
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
