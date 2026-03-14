/**
 * @module components/auth/ProtectedRoute
 *
 * Route guard that ensures a valid session (authenticated or guest) exists.
 * Auto-initializes a guest session for first-time visitors so the chat
 * page serves as the default landing experience.
 */

import { useEffect, useRef } from "react";

import { Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext.js";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isGuest, isLoading, initGuest, guestLimitReached } = useAuth();
  const initRef = useRef(false);

  // Auto-initialize guest session when no auth state exists
  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isGuest && !guestLimitReached && !initRef.current) {
      initRef.current = true;
      initGuest();
    }
  }, [isLoading, isAuthenticated, isGuest, guestLimitReached, initGuest]);

  // Even when guest limit is reached, keep the user on the page.
  // The chat will show an inline prompt to register/login when they
  // try to send a message (403 from the server).

  // Show spinner while auth is loading or guest session is being created
  // (but not when guest limit is reached — render children so they see the chat with inline prompt)
  if (isLoading || (!isAuthenticated && !isGuest && !guestLimitReached)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <Loader2 className="size-8 animate-spin text-amber-600" />
      </div>
    );
  }

  return <>{children}</>;
}
