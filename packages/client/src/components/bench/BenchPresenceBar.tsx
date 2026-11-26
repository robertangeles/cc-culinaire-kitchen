/**
 * Presence bar showing online users ("chefs on the pass").
 * An avatar opens the person's card: Message, Report, Block.
 */

import type { PresenceUser } from "../../hooks/useBenchPresence.js";
import type { BenchPerson, ReportTarget } from "../../hooks/useBenchSafety.js";
import { BenchPersonMenu } from "./BenchPersonMenu.js";

interface BenchPresenceBarProps {
  users: PresenceUser[];
  /** The viewer: their own avatar opens nothing. */
  selfId?: number;
  onStartDm?: (userId: number) => void;
  onReport?: (target: ReportTarget) => void;
  onBlock?: (person: BenchPerson) => void;
}

export function BenchPresenceBar({ users, selfId, onStartDm, onReport, onBlock }: BenchPresenceBarProps) {
  const MAX_AVATARS = 8;
  const visible = users.slice(0, MAX_AVATARS);
  const overflow = users.length - MAX_AVATARS;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-dark-200 bg-dark-50">
      <div className="flex -space-x-2">
        {visible.map((u) => {
          const avatar = u.userPhotoPath ? (
            <img
              src={u.userPhotoPath}
              alt={u.userName}
              className="size-8 rounded-full border-2 border-dark-50 object-cover cursor-pointer"
            />
          ) : (
            <div className="size-8 rounded-full border-2 border-dark-50 bg-gold/15 flex items-center justify-center cursor-pointer">
              <span className="text-xs font-semibold text-gold">
                {u.userName.charAt(0).toUpperCase()}
              </span>
            </div>
          );
          return u.userId === selfId ? (
            <span key={u.userId} title={u.userName} className="relative">{avatar}</span>
          ) : (
            <BenchPersonMenu
              key={u.userId}
              person={u}
              onMessage={onStartDm}
              onReport={onReport}
              onBlock={onBlock}
              label={`${u.userName}: options`}
              triggerClassName="relative rounded-full hover:z-10 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 transition-transform"
            >
              {avatar}
            </BenchPersonMenu>
          );
        })}
        {overflow > 0 && (
          <div className="size-8 rounded-full border-2 border-dark-50 bg-dark-200 flex items-center justify-center">
            <span className="text-xs font-medium text-dark-600">+{overflow}</span>
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
