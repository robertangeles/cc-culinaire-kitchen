/**
 * @module components/recipes/RecipeRatings
 *
 * Interactive star ratings + review list for recipes.
 * Authenticated users can rate and write reviews; guests see read-only ratings.
 */

import { useState } from "react";
import { Star, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useRecipeRatings } from "../../hooks/useRecipeRatings";

interface RecipeRatingsProps {
  recipeId: string;
  compact?: boolean; // Gallery card mode — stars + count only
}

/** Filled / empty / half star rendering */
function StarIcon({
  filled,
  half,
  size = 20,
  className = "",
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  filled: boolean;
  half?: boolean;
  size?: number;
  className?: string;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return (
    <Star
      size={size}
      className={`transition-colors ${className} ${
        filled
          ? "fill-[#D4A574] text-[#D4A574]"
          : "fill-none text-[#3A3A3A]"
      }`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ cursor: onClick ? "pointer" : "default" }}
    />
  );
}

/** Read-only star row — used on gallery cards */
export function StarDisplay({
  average,
  count,
  size = 16,
  showEmpty = false,
}: {
  average: number;
  count: number;
  size?: number;
  /** Show empty stars when there are no ratings yet */
  showEmpty?: boolean;
}) {
  const avg = Number(average) || 0;
  const cnt = Number(count) || 0;
  if (cnt === 0 && !showEmpty) return null;
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={
            n <= Math.round(avg)
              ? "fill-[#D4A574] text-[#D4A574]"
              : "fill-none text-[#3A3A3A]"
          }
        />
      ))}
      <span className="text-xs text-[#999999] ml-1">
        {cnt === 0 ? "No ratings yet" : `${avg.toFixed(1)} (${cnt})`}
      </span>
    </div>
  );
}

export default function RecipeRatings({ recipeId, compact }: RecipeRatingsProps) {
  const { user } = useAuth();
  const { data, loading, submitRating, submitReview, deleteReview } =
    useRecipeRatings(recipeId);

  const [hoverStar, setHoverStar] = useState(0);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewBody, setReviewBody] = useState("");
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewHover, setReviewHover] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showAllReviews, setShowAllReviews] = useState(false);

  if (loading && !data) {
    return <div className="py-4 text-center text-[#999999] text-sm">Loading ratings...</div>;
  }
  if (!data) return null;

  // Compact mode for gallery cards
  if (compact) {
    return <StarDisplay average={data.average} count={data.count} size={14} showEmpty />;
  }

  const displayedStars = hoverStar || data.userRating || 0;
  const visibleReviews = showAllReviews ? data.reviews : data.reviews.slice(0, 3);

  async function handleStarClick(rating: number) {
    if (!user) return;
    setError("");
    try {
      await submitRating(rating);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleReviewSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError("");
    setSubmitting(true);
    try {
      await submitReview(reviewBody, reviewRating, reviewTitle || undefined);
      setShowReviewForm(false);
      setReviewTitle("");
      setReviewBody("");
      setReviewRating(0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(reviewId: number) {
    try {
      await deleteReview(reviewId);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="mx-6 md:mx-10 mb-6 border-t border-[#2A2A2A] pt-6">
      {/* Average rating header */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              size={24}
              className={
                n <= Math.round(data.average)
                  ? "fill-[#D4A574] text-[#D4A574]"
                  : "fill-none text-[#3A3A3A]"
              }
            />
          ))}
        </div>
        <div className="text-sm text-[#E5E5E5]">
          <span className="font-semibold text-[#FAFAFA]">{data.average.toFixed(1)}</span>
          {" "}out of 5
          <span className="text-[#666666] ml-1">
            ({data.count} {data.count === 1 ? "rating" : "ratings"})
          </span>
        </div>
      </div>

      {/* Distribution bars */}
      <div className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 mb-6 max-w-sm">
        {[5, 4, 3, 2, 1].map((n) => {
          const pct = data.count > 0 ? ((data.distribution[n] ?? 0) / data.count) * 100 : 0;
          return (
            <div key={n} className="contents">
              <span className="text-xs text-[#999999] w-8 text-right">{n} star</span>
              <div className="h-2 bg-[#2A2A2A] rounded-full self-center overflow-hidden">
                <div
                  className="h-full bg-[#D4A574] rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs text-[#666666] w-6">{data.distribution[n] ?? 0}</span>
            </div>
          );
        })}
      </div>

      {/* User's star rating */}
      {user ? (
        <div className="mb-4">
          <p className="text-sm text-[#E5E5E5] mb-2">
            {data.userRating ? "Your rating" : "Rate this recipe"}
          </p>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <StarIcon
                key={n}
                size={28}
                filled={n <= displayedStars}
                className="hover:scale-110"
                onClick={() => handleStarClick(n)}
                onMouseEnter={() => setHoverStar(n)}
                onMouseLeave={() => setHoverStar(0)}
              />
            ))}
            {data.userRating && (
              <span className="text-xs text-[#999999] ml-2">
                You rated this {data.userRating}/5
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-[#999999] italic mb-4">
          Sign in to rate this recipe
        </p>
      )}

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {/* Write a review */}
      {user && !showReviewForm && (
        <button
          onClick={() => setShowReviewForm(true)}
          className="text-sm text-[#D4A574] hover:text-[#C4956A] font-medium mb-4"
        >
          Write a Review
        </button>
      )}

      {showReviewForm && (
        <form onSubmit={handleReviewSubmit} className="mb-6 p-4 bg-[#1E1E1E] rounded-xl space-y-3 border border-[#2A2A2A]">
          <p className="text-sm font-medium text-[#FAFAFA]">Your Review</p>

          {/* Review star rating */}
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <StarIcon
                key={n}
                size={24}
                filled={n <= (reviewHover || reviewRating)}
                className="hover:scale-110"
                onClick={() => setReviewRating(n)}
                onMouseEnter={() => setReviewHover(n)}
                onMouseLeave={() => setReviewHover(0)}
              />
            ))}
            {reviewRating > 0 && (
              <span className="text-xs text-[#999999] ml-2">{reviewRating}/5</span>
            )}
          </div>

          <input
            type="text"
            placeholder="Review title (optional)"
            value={reviewTitle}
            onChange={(e) => setReviewTitle(e.target.value)}
            maxLength={200}
            className="w-full px-4 py-3 text-sm text-white bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl placeholder-[#444444] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]"
          />

          <textarea
            placeholder="Share your experience with this recipe..."
            value={reviewBody}
            onChange={(e) => setReviewBody(e.target.value)}
            rows={4}
            maxLength={5000}
            className="w-full px-4 py-3 text-sm text-white bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl placeholder-[#444444] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574] resize-none"
          />

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={submitting || reviewRating === 0 || reviewBody.length < 10}
              className="px-4 py-2 text-sm bg-[#D4A574] text-[#0A0A0A] rounded-lg hover:bg-[#C4956A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Submitting..." : "Submit Review"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowReviewForm(false);
                setError("");
              }}
              className="px-4 py-2 text-sm text-[#999999] hover:text-white"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Review list */}
      {data.reviews.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-[#FAFAFA]">
            Reviews ({data.reviews.length})
          </p>

          {visibleReviews.map((review) => (
            <div key={review.reviewId} className="p-4 bg-[#1E1E1E] border border-[#2A2A2A] rounded-xl">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          size={14}
                          className={
                            n <= review.rating
                              ? "fill-[#D4A574] text-[#D4A574]"
                              : "fill-none text-[#3A3A3A]"
                          }
                        />
                      ))}
                    </div>
                    <span className="text-xs font-medium text-[#FAFAFA]">
                      {review.userName}
                    </span>
                    <span className="text-xs text-[#666666]">
                      {new Date(review.createdDttm).toLocaleDateString()}
                    </span>
                  </div>
                  {review.reviewTitle && (
                    <p className="text-sm font-medium text-[#FAFAFA] mb-1">
                      {review.reviewTitle}
                    </p>
                  )}
                  <p className="text-sm text-[#E5E5E5]">{review.reviewBody}</p>
                </div>

                {/* Delete: own review or admin */}
                {user && (user.userId === review.userId || user.roles?.includes("Administrator")) && (
                  <button
                    onClick={() => handleDelete(review.reviewId)}
                    className="text-[#666666] hover:text-red-400 transition-colors ml-2 shrink-0"
                    title="Delete your review"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}

          {data.reviews.length > 3 && (
            <button
              onClick={() => setShowAllReviews(!showAllReviews)}
              className="flex items-center gap-1 text-sm text-[#D4A574] hover:text-[#C4956A]"
            >
              {showAllReviews ? (
                <>
                  <ChevronUp size={16} /> Show less
                </>
              ) : (
                <>
                  <ChevronDown size={16} /> Show all {data.reviews.length} reviews
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
