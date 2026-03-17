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
      className="bg-white rounded-xl shadow-lg border border-stone-200 p-3 flex items-start gap-3 cursor-pointer hover:bg-stone-50 transition-colors animate-slide-in"
    >
      {notification.userPhotoPath ? (
        <img src={notification.userPhotoPath} alt={notification.userName} className="size-9 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div className="size-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-semibold text-amber-700">{notification.userName.charAt(0).toUpperCase()}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <MessageCircle className="size-3 text-amber-600" />
          <span className="text-xs font-semibold text-stone-800">{notification.userName}</span>
        </div>
        <p className="text-xs text-stone-600 truncate">{notification.message}</p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(notification.id); }}
        className="p-0.5 rounded hover:bg-stone-200 text-stone-400 flex-shrink-0"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
