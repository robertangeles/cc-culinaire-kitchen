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
    <div className="flex items-center gap-3 px-4 py-2 border-b border-stone-200 bg-white">
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
                className="size-7 rounded-full border-2 border-white object-cover cursor-pointer"
              />
            ) : (
              <div className="size-7 rounded-full border-2 border-white bg-amber-100 flex items-center justify-center cursor-pointer">
                <span className="text-xs font-semibold text-amber-700">
                  {u.userName.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </button>
        ))}
        {overflow > 0 && (
          <div className="size-7 rounded-full border-2 border-white bg-stone-200 flex items-center justify-center">
            <span className="text-xs font-medium text-stone-600">+{overflow}</span>
          </div>
        )}
      </div>
      <span className="text-xs text-stone-500">
        {users.length === 0
          ? "No one on the pass"
          : `${users.length} ${users.length === 1 ? "chef" : "chefs"} on the pass`}
      </span>
    </div>
  );
}
