/**
 * Presence bar showing online users ("chefs on the pass").
 * Avatars are clickable to start a DM.
 */

import type { PresenceUser } from "../../hooks/useBenchPresence.js";

interface BenchPresenceBarProps {
  users: PresenceUser[];
  onStartDm?: (userId: number) => void;
}

export function BenchPresenceBar({ users, onStartDm }: BenchPresenceBarProps) {
  const MAX_AVATARS = 8;
  const visible = users.slice(0, MAX_AVATARS);
  const overflow = users.length - MAX_AVATARS;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#2A2A2A] bg-[#161616]">
      <div className="flex -space-x-2">
        {visible.map((u) => (
          <button
            key={u.userId}
            onClick={() => onStartDm?.(u.userId)}
            title={`Message ${u.userName}`}
            className="relative hover:z-10 hover:scale-110 transition-transform"
          >
            {u.userPhotoPath ? (
              <img
                src={u.userPhotoPath}
                alt={u.userName}
                className="size-8 rounded-full border-2 border-[#161616] object-cover cursor-pointer"
              />
            ) : (
              <div className="size-8 rounded-full border-2 border-[#161616] bg-[#D4A574]/15 flex items-center justify-center cursor-pointer">
                <span className="text-xs font-semibold text-[#D4A574]">
                  {u.userName.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </button>
        ))}
        {overflow > 0 && (
          <div className="size-8 rounded-full border-2 border-[#161616] bg-[#2A2A2A] flex items-center justify-center">
            <span className="text-xs font-medium text-[#999999]">+{overflow}</span>
          </div>
        )}
      </div>
      <span className="text-sm text-[#E5E5E5]">
        {users.length === 0
          ? "No one on the pass"
          : `${users.length} ${users.length === 1 ? "chef" : "chefs"} on the pass`}
      </span>
    </div>
  );
}
