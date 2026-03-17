/**
 * @module components/recipes/CreatorCard
 *
 * "Added By" label with hover popover showing the recipe creator's
 * photo, name, bio, and social links.
 */

import { useState, useRef } from "react";
import { User } from "lucide-react";

// Simple inline SVG icons for social links (avoid importing heavy icon packs)
const SOCIAL_ICONS: Record<string, { label: string; color: string; icon: string }> = {
  facebook: { label: "Facebook", color: "hover:text-blue-600", icon: "M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" },
  instagram: { label: "Instagram", color: "hover:text-pink-600", icon: "M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 01-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 017.8 2m-.2 2A3.6 3.6 0 004 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 003.6-3.6V7.6C20 5.61 18.39 4 16.4 4H7.6m9.65 1.5a1.25 1.25 0 110 2.5 1.25 1.25 0 010-2.5M12 7a5 5 0 110 10 5 5 0 010-10m0 2a3 3 0 100 6 3 3 0 000-6z" },
  tiktok: { label: "TikTok", color: "hover:text-stone-900", icon: "M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.61a8.21 8.21 0 004.76 1.51V6.69h-1z" },
  pinterest: { label: "Pinterest", color: "hover:text-red-600", icon: "M12 2C6.477 2 2 6.477 2 12a9.99 9.99 0 006.838 9.488c-.031-.724-.003-1.594.18-2.381l1.3-5.508s-.322-.645-.322-1.599c0-1.498.869-2.617 1.95-2.617.92 0 1.363.69 1.363 1.517 0 .924-.589 2.306-.893 3.588-.254 1.072.538 1.946 1.595 1.946 1.914 0 3.385-2.018 3.385-4.93 0-2.579-1.853-4.381-4.5-4.381-3.065 0-4.862 2.299-4.862 4.674 0 .925.356 1.917.801 2.455a.32.32 0 01.075.31c-.082.34-.264 1.072-.3 1.222-.047.197-.155.239-.358.144-1.337-.622-2.173-2.577-2.173-4.148 0-3.38 2.455-6.482 7.081-6.482 3.717 0 6.605 2.649 6.605 6.188 0 3.694-2.329 6.665-5.562 6.665-1.086 0-2.107-.564-2.456-1.23l-.668 2.547c-.242.93-.896 2.094-1.335 2.804A10 10 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z" },
  linkedin: { label: "LinkedIn", color: "hover:text-blue-700", icon: "M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2zM4 2a2 2 0 110 4 2 2 0 010-4z" },
};

export interface CreatorInfo {
  userName: string;
  userPhotoPath: string | null;
  userBio: string | null;
  userFacebook: string | null;
  userInstagram: string | null;
  userTiktok: string | null;
  userPinterest: string | null;
  userLinkedin: string | null;
  restaurantName: string | null;
}

interface CreatorCardProps {
  creator: CreatorInfo;
}

export function CreatorCard({ creator }: CreatorCardProps) {
  const [showPopover, setShowPopover] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const displayName = creator.restaurantName || creator.userName;

  // Collect non-empty social links
  const socials: { key: string; url: string }[] = [];
  if (creator.userFacebook) socials.push({ key: "facebook", url: creator.userFacebook });
  if (creator.userInstagram) socials.push({ key: "instagram", url: creator.userInstagram });
  if (creator.userTiktok) socials.push({ key: "tiktok", url: creator.userTiktok });
  if (creator.userPinterest) socials.push({ key: "pinterest", url: creator.userPinterest });
  if (creator.userLinkedin) socials.push({ key: "linkedin", url: creator.userLinkedin });

  // Only show if there's something to display beyond just the name
  const hasPopoverContent = creator.userPhotoPath || creator.userBio || socials.length > 0;

  function handleMouseEnter() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShowPopover(true);
  }

  function handleMouseLeave() {
    timeoutRef.current = setTimeout(() => setShowPopover(false), 200);
  }

  return (
    <div
      className="relative inline-flex items-center gap-1"
      onMouseEnter={hasPopoverContent ? handleMouseEnter : undefined}
      onMouseLeave={hasPopoverContent ? handleMouseLeave : undefined}
    >
      <span className="text-xs text-stone-400">Added by</span>
      <span className={`text-xs font-medium text-stone-600 ${hasPopoverContent ? "cursor-pointer hover:text-amber-700 transition-colors" : ""}`}>
        {displayName}
      </span>

      {/* Hover popover */}
      {showPopover && hasPopoverContent && (
        <div
          className="absolute bottom-full left-0 mb-2 w-64 bg-white rounded-xl shadow-lg border border-stone-200 p-4 z-50"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Arrow */}
          <div className="absolute -bottom-1.5 left-6 w-3 h-3 bg-white border-r border-b border-stone-200 rotate-45" />

          <div className="flex items-start gap-3">
            {/* Photo */}
            {creator.userPhotoPath ? (
              <img
                src={creator.userPhotoPath}
                alt={creator.userName}
                className="size-12 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div className="size-12 rounded-full bg-stone-100 flex items-center justify-center flex-shrink-0">
                <User className="size-6 text-stone-400" />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-stone-800 truncate">{creator.userName}</p>
              {creator.restaurantName && (
                <p className="text-xs text-amber-700 truncate">{creator.restaurantName}</p>
              )}
            </div>
          </div>

          {/* Bio */}
          {creator.userBio && (
            <p className="text-xs text-stone-500 mt-2 line-clamp-3 leading-relaxed">
              {creator.userBio}
            </p>
          )}

          {/* Social links */}
          {socials.length > 0 && (
            <div className="flex items-center gap-2 mt-3 pt-2 border-t border-stone-100">
              {socials.map(({ key, url }) => {
                const social = SOCIAL_ICONS[key];
                if (!social) return null;
                return (
                  <a
                    key={key}
                    href={url.startsWith("http") ? url : `https://${url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-stone-400 ${social.color} transition-colors`}
                    title={social.label}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d={social.icon} />
                    </svg>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
