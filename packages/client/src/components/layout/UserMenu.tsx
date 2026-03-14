/**
 * @module components/layout/UserMenu
 *
 * User avatar + name + role badge shown at the bottom of the sidebar.
 * Click opens a dropdown with Profile, MFA Settings, and Logout options.
 */

import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import { User, ShieldCheck, LogOut, ChevronUp } from "lucide-react";
import { useAuth } from "../../context/AuthContext.js";

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!user) return null;

  const initials = user.userName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const primaryRole = user.roles[0] ?? "Subscriber";

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  if (compact) {
    return (
      <div ref={menuRef} className="relative pb-2">
        {open && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 w-44 bg-stone-700 rounded-lg shadow-lg border border-stone-600 overflow-hidden z-50">
            <button
              onClick={() => { navigate("/profile"); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-stone-200 hover:bg-stone-600 transition-colors"
            >
              <User className="size-4" />
              Profile
            </button>
            <button
              onClick={() => { navigate("/mfa-setup"); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-stone-200 hover:bg-stone-600 transition-colors"
            >
              <ShieldCheck className="size-4" />
              MFA Settings
            </button>
            <div className="border-t border-stone-600" />
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-400 hover:bg-stone-600 transition-colors"
            >
              <LogOut className="size-4" />
              Sign Out
            </button>
          </div>
        )}
        <button
          onClick={() => setOpen(!open)}
          title={user.userName}
          className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-stone-700/50 transition-colors"
        >
          {user.userPhotoPath ? (
            <img src={user.userPhotoPath} alt={user.userName} className="size-8 rounded-full object-cover" />
          ) : (
            <div className="size-8 rounded-full bg-amber-600 flex items-center justify-center text-xs font-semibold text-white">
              {initials}
            </div>
          )}
        </button>
      </div>
    );
  }

  return (
    <div ref={menuRef} className="relative px-3 pb-2">
      {/* Dropdown menu — opens upward */}
      {open && (
        <div className="absolute bottom-full left-3 right-3 mb-1 bg-stone-700 rounded-lg shadow-lg border border-stone-600 overflow-hidden z-50">
          <button
            onClick={() => { navigate("/profile"); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-stone-200 hover:bg-stone-600 transition-colors"
          >
            <User className="size-4" />
            Profile
          </button>
          <button
            onClick={() => { navigate("/mfa-setup"); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-stone-200 hover:bg-stone-600 transition-colors"
          >
            <ShieldCheck className="size-4" />
            MFA Settings
          </button>
          <div className="border-t border-stone-600" />
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-400 hover:bg-stone-600 transition-colors"
          >
            <LogOut className="size-4" />
            Sign Out
          </button>
        </div>
      )}

      {/* User button */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-stone-700/50 transition-colors"
      >
        {user.userPhotoPath ? (
          <img
            src={user.userPhotoPath}
            alt={user.userName}
            className="size-8 rounded-full object-cover"
          />
        ) : (
          <div className="size-8 rounded-full bg-amber-600 flex items-center justify-center text-xs font-semibold text-white">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{user.userName}</p>
          <p className="text-xs text-stone-400 truncate">{primaryRole}</p>
        </div>
        <ChevronUp className={`size-4 text-stone-400 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
    </div>
  );
}
