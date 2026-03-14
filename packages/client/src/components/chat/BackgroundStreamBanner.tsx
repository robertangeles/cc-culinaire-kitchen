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
                ? "bg-red-50 border-red-200 text-red-800"
                : "bg-amber-50 border-amber-200 text-amber-800"
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
                  className="px-3 py-1 text-xs font-medium text-amber-700 bg-amber-100 rounded-md hover:bg-amber-200 transition-colors"
                >
                  View
                </button>
              )}
              <button
                onClick={() => dismissStream(convId)}
                className="p-1 text-stone-400 hover:text-stone-600 transition-colors"
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
