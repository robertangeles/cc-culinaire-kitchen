/**
 * @module hooks/useNotifications
 *
 * Hook for the notification bell — unread count, list, mark as read/dismissed.
 * Polls every 60 seconds for new notifications.
 */

import { useState, useEffect, useCallback, useRef } from "react";

const API = "/api/inventory";
const opts = { credentials: "include" as const };

export interface AppNotification {
  notificationId: string;
  organisationId: number;
  recipientUserId: number;
  type: string;
  channel: string;
  status: string;
  payload: Record<string, unknown>;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  sentAt: string | null;
  readAt: string | null;
  createdAt: string;
}

const POLL_INTERVAL_MS = 60_000;

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      const res = await fetch(`${API}/notifications/count`, opts);
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.count);
      }
    } catch {
      // Silently fail — notification polling shouldn't block anything
    }
  }, []);

  const refreshList = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/notifications?limit=20`, opts);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
        setUnreadCount(data.length);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const markAsRead = useCallback(async (notificationId: string) => {
    const res = await fetch(`${API}/notifications/${notificationId}/read`, {
      ...opts,
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      setNotifications((prev) =>
        prev.filter((n) => n.notificationId !== notificationId),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
  }, []);

  const dismiss = useCallback(async (notificationId: string) => {
    const res = await fetch(`${API}/notifications/${notificationId}/dismiss`, {
      ...opts,
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      setNotifications((prev) =>
        prev.filter((n) => n.notificationId !== notificationId),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
  }, []);

  // Poll for unread count
  useEffect(() => {
    refreshCount();
    intervalRef.current = setInterval(refreshCount, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshCount]);

  return {
    notifications,
    unreadCount,
    isLoading,
    refreshList,
    refreshCount,
    markAsRead,
    dismiss,
  };
}
