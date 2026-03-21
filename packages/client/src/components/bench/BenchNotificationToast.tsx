/**
 * Toast notification for incoming DMs and @mentions.
 * Appears in the top-right corner and auto-dismisses after 5 seconds.
 */

import { useState, useEffect } from "react";
import { X, MessageCircle } from "lucide-react";

export interface BenchNotification {
  id: string;
  userName: string;
  userPhotoPath: string | null;
  message: string;
  type: "dm" | "mention";
  onClick?: () => void;
}

interface BenchNotificationToastProps {
  notifications: BenchNotification[];
  onDismiss: (id: string) => void;
}

export function BenchNotificationToast({ notifications, onDismiss }: BenchNotificationToastProps) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {notifications.map((n) => (
        <ToastItem key={n.id} notification={n} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ notification, onDismiss }: { notification: BenchNotification; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(notification.id), 5000);
    return () => clearTimeout(timer);
  }, [notification.id, onDismiss]);

  return (
    <div
      onClick={() => {
        notification.onClick?.();
        onDismiss(notification.id);
      }}
      className="bg-[#1E1E1E] rounded-xl shadow-xl shadow-black/40 border border-[#D4A574]/20 p-4 flex items-start gap-3 cursor-pointer hover:bg-[#2A2A2A] transition-colors animate-slide-in"
    >
      {notification.userPhotoPath ? (
        <img src={notification.userPhotoPath} alt={notification.userName} className="size-9 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div className="size-9 rounded-full bg-[#D4A574]/15 flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-semibold text-[#D4A574]">{notification.userName.charAt(0).toUpperCase()}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <MessageCircle className="size-3 text-[#D4A574]" />
          <span className="text-sm font-semibold text-[#FAFAFA]">{notification.userName}</span>
        </div>
        <p className="text-sm text-[#E5E5E5] truncate mt-0.5">{notification.message}</p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(notification.id); }}
        className="p-0.5 rounded hover:bg-[#2A2A2A] text-[#666666] flex-shrink-0"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
