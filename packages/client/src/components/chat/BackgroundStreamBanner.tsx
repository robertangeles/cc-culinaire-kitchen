/**
 * @module BackgroundStreamBanner
 *
 * Notification banner that appears when an AI response completes
 * in the background (i.e., the user navigated away while the model
 * was still generating). Shows one banner per completed stream.
 */

import { useNavigate } from "react-router";
import { MessageSquare, X } from "lucide-react";
import { useChatStream } from "../../context/ChatStreamContext.js";

/**
 * Renders a banner at the top of the page for each completed
 * background chat stream. Provides "View" and "Dismiss" actions.
 */
export function BackgroundStreamBanner() {
  const { completedStreamIds, backgroundStreams, dismissStream } =
    useChatStream();
  const navigate = useNavigate();

  if (completedStreamIds.length === 0) return null;

  return (
    <div className="flex flex-col">
      {completedStreamIds.map((convId) => {
        const stream = backgroundStreams.get(convId);
        if (!stream) return null;

        const isError = stream.status === "error";

        return (
          <div
            key={convId}
            className={`flex items-center justify-between px-4 py-2 text-sm border-b ${
              isError
                ? "bg-red-900/30 border-red-800/50 text-red-300"
                : "bg-[#D4A574]/10 border-[#D4A574]/20 text-[#D4A574]"
            }`}
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 flex-shrink-0" />
              <span>
                {isError
                  ? `Background response failed: ${stream.error ?? "Unknown error"}`
                  : `AI response ready — "${stream.title}"`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {!isError && (
                <button
                  onClick={() => {
                    navigate(`/chat/${convId}`);
                  }}
                  className="px-3 py-1 text-xs font-medium text-[#0A0A0A] bg-[#D4A574] rounded-xl hover:bg-[#C4956A] transition-colors"
                >
                  View
                </button>
              )}
              <button
                onClick={() => dismissStream(convId)}
                className="p-1 text-[#666666] hover:text-[#999999] transition-colors"
                title="Dismiss"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
