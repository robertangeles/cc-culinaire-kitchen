/**
 * @module components/layout/NotificationBell
 *
 * Notification bell for the header bar — shows unread count badge,
 * dropdown with notification list, click to navigate.
 */

import { useState, useRef, useEffect } from "react";
import { useNotifications, type AppNotification } from "../../hooks/useNotifications.js";
import { Bell, Check, X, FileText, AlertTriangle, Clock, Truck } from "lucide-react";

const TYPE_CONFIG: Record<string, { icon: typeof Bell; color: string; label: string }> = {
  APPROVAL_REQUIRED: { icon: FileText,      color: "text-amber-400",   label: "Approval needed" },
  PO_APPROVED:       { icon: Check,          color: "text-emerald-400", label: "PO approved" },
  PO_REJECTED:       { icon: X,              color: "text-red-400",     label: "PO rejected" },
  DISCREPANCY_ALERT: { icon: AlertTriangle,  color: "text-orange-400",  label: "Discrepancy" },
  DELIVERY_OVERDUE:  { icon: Clock,          color: "text-red-400",     label: "Delivery overdue" },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function NotificationBell() {
  const { notifications, unreadCount, isLoading, refreshList, markAsRead, dismiss } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  const handleOpen = () => {
    setIsOpen(!isOpen);
    if (!isOpen) refreshList();
  };

  const handleNotificationClick = (n: AppNotification) => {
    markAsRead(n.notificationId);
    // Navigate to related entity if applicable
    if (n.relatedEntityType === "purchase_order" && n.relatedEntityId) {
      window.location.href = `/inventory?tab=purchase-orders&po=${n.relatedEntityId}`;
    }
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className="relative">
      {/* Bell button */}
      <button
        onClick={handleOpen}
        className="relative p-2 rounded-lg text-[#999] hover:text-white hover:bg-[#1E1E1E]
          transition-all"
        aria-label="Notifications"
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center
            rounded-full bg-[#D4A574] text-[#0A0A0A] text-[10px] font-bold px-1
            animate-[pulse_2s_ease-in-out_infinite]">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto
          bg-[#1E1E1E]/95 backdrop-blur-md border border-[#2A2A2A] rounded-xl
          shadow-[0_8px_32px_rgba(0,0,0,0.5)] z-50
          animate-[fadeInUp_150ms_ease-out]">
          <div className="px-4 py-3 border-b border-[#2A2A2A]">
            <h3 className="text-sm font-semibold text-white">Notifications</h3>
          </div>

          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Bell className="size-8 mx-auto text-[#333] mb-2" />
              <p className="text-sm text-[#666]">No new notifications</p>
            </div>
          ) : (
            <div className="divide-y divide-[#2A2A2A]">
              {notifications.map((n) => {
                const config = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.APPROVAL_REQUIRED;
                const Icon = config.icon;
                const payload = n.payload as Record<string, string>;

                return (
                  <div
                    key={n.notificationId}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-[#2A2A2A]/50
                      cursor-pointer transition-all"
                    onClick={() => handleNotificationClick(n)}
                  >
                    <div className={`shrink-0 mt-0.5 ${config.color}`}>
                      <Icon className="size-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white">{config.label}</div>
                      <div className="text-xs text-[#999] mt-0.5 truncate">
                        {payload.poNumber && `PO ${payload.poNumber}`}
                        {payload.reason && ` — ${payload.reason}`}
                        {payload.supplierName && ` — ${payload.supplierName}`}
                      </div>
                      <div className="text-[10px] text-[#666] mt-1">{timeAgo(n.createdAt)}</div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dismiss(n.notificationId);
                      }}
                      className="shrink-0 p-1 text-[#666] hover:text-white transition-all"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
