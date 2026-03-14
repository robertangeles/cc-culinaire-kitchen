/**
 * @module MessageSkeleton
 *
 * Pulsing placeholder shown in the message area while a conversation's
 * history is being fetched from the API. Keeps the layout stable (input
 * bar visible) instead of replacing the entire content area with a spinner.
 */

export function MessageSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 animate-pulse">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        {/* User message skeleton */}
        <div className="flex justify-end">
          <div className="h-9 w-48 rounded-2xl bg-stone-200" />
        </div>

        {/* Assistant message skeleton — multi-line */}
        <div className="flex gap-3">
          <div className="size-8 rounded-full bg-stone-200 shrink-0 mt-1" />
          <div className="flex flex-col gap-2 flex-1 max-w-lg">
            <div className="h-4 w-3/4 rounded bg-stone-200" />
            <div className="h-4 w-full rounded bg-stone-200" />
            <div className="h-4 w-5/6 rounded bg-stone-200" />
            <div className="h-4 w-2/3 rounded bg-stone-200" />
          </div>
        </div>

        {/* Second user message skeleton */}
        <div className="flex justify-end">
          <div className="h-9 w-36 rounded-2xl bg-stone-200" />
        </div>

        {/* Second assistant message skeleton */}
        <div className="flex gap-3">
          <div className="size-8 rounded-full bg-stone-200 shrink-0 mt-1" />
          <div className="flex flex-col gap-2 flex-1 max-w-md">
            <div className="h-4 w-full rounded bg-stone-200" />
            <div className="h-4 w-4/5 rounded bg-stone-200" />
            <div className="h-4 w-3/5 rounded bg-stone-200" />
          </div>
        </div>
      </div>
    </div>
  );
}
