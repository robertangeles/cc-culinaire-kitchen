/**
 * @module components/recipes/RecipeShareBar
 *
 * Social media share bar for recipes. Supports native Web Share API
 * (mobile) with fallback to direct platform share links (desktop).
 *
 * Platforms: WhatsApp, Facebook, X (Twitter), Pinterest, Instagram
 * (caption copy), Email, Copy Link.
 */

import { useState } from "react";
import { Share2, Link2, Mail, Check, X as XIcon, Loader2 } from "lucide-react";

interface RecipeShareBarProps {
  title: string;
  description: string;
  hookLine?: string;
  hashtags?: string[];
  imageUrl?: string | null;
  slug?: string;
  recipeId?: string;
}

export function RecipeShareBar({
  title,
  description,
  hookLine,
  hashtags,
  imageUrl,
  slug,
  recipeId,
}: RecipeShareBarProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailResult, setEmailResult] = useState<string | null>(null);

  const url = `${window.location.origin}/kitchen-shelf/${slug ?? recipeId ?? ""}`;
  const text = hookLine || description.slice(0, 140);
  const hashtagStr = hashtags?.join(" ") ?? "#CulinAIre";
  const fullText = `${text}\n\n${hashtagStr}`;

  function showToast(key: string) {
    setCopied(key);
    setTimeout(() => setCopied(null), 2500);
  }

  async function handleNativeShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title, text: fullText, url });
      } catch { /* user cancelled */ }
    }
  }

  function handleWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n\n${url}`)}`, "_blank");
  }

  function handleFacebook() {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, "_blank", "width=600,height=400");
  }

  function handleX() {
    const tweetText = `${text} ${hashtags?.slice(0, 3).join(" ") ?? ""}`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(url)}`, "_blank", "width=600,height=400");
  }

  function handlePinterest() {
    const desc = encodeURIComponent(`${title} — ${text}`);
    const media = imageUrl ? encodeURIComponent(imageUrl) : "";
    window.open(`https://pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&media=${media}&description=${desc}`, "_blank", "width=600,height=600");
  }

  const [igOpen, setIgOpen] = useState(false);

  function handleInstagram() {
    navigator.clipboard.writeText(`${text}\n\n${hashtagStr}\n\nRecipe: ${url}`);
    setIgOpen(true);
  }

  async function handleEmailSend() {
    if (!emailTo.trim()) return;
    setEmailSending(true);
    setEmailResult(null);
    try {
      const gt = localStorage.getItem("culinaire_guest_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (gt) headers["X-Guest-Token"] = gt;
      const res = await fetch(`/api/recipes/${recipeId}/email`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ to: emailTo.trim() }),
      });
      if (res.ok) {
        setEmailResult("sent");
        setTimeout(() => { setEmailOpen(false); setEmailResult(null); setEmailTo(""); }, 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        setEmailResult((data as any).error ?? "Failed to send");
      }
    } catch {
      setEmailResult("Failed to send email");
    } finally {
      setEmailSending(false);
    }
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(url);
    showToast("link");
  }

  const btnClass = "p-2 rounded-lg hover:bg-stone-100 transition-colors group relative";
  const iconClass = "size-5";

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Native Share — primary button on mobile (opens share sheet with Instagram, WhatsApp, etc.) */}
      {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
        <button onClick={handleNativeShare} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 transition-colors" title="Share to any app">
          <Share2 className="size-4" />
          Share
        </button>
      )}

      {/* WhatsApp */}
      <button onClick={handleWhatsApp} className={btnClass} title="Share on WhatsApp">
        <svg className={iconClass} viewBox="0 0 24 24" fill="#25D366">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      </button>

      {/* Facebook */}
      <button onClick={handleFacebook} className={btnClass} title="Share on Facebook">
        <svg className={iconClass} viewBox="0 0 24 24" fill="#1877F2">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
        </svg>
      </button>

      {/* X (Twitter) */}
      <button onClick={handleX} className={btnClass} title="Share on X">
        <svg className={iconClass} viewBox="0 0 24 24" fill="#000">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      </button>

      {/* Pinterest */}
      <button onClick={handlePinterest} className={btnClass} title="Pin on Pinterest">
        <svg className={iconClass} viewBox="0 0 24 24" fill="#E60023">
          <path d="M12 0a12 12 0 00-4.373 23.178c-.07-.633-.134-1.606.028-2.298.146-.625.938-3.978.938-3.978s-.239-.479-.239-1.187c0-1.113.645-1.943 1.448-1.943.683 0 1.012.512 1.012 1.127 0 .687-.437 1.712-.663 2.663-.188.796.4 1.446 1.185 1.446 1.422 0 2.515-1.5 2.515-3.664 0-1.915-1.377-3.254-3.342-3.254-2.276 0-3.612 1.707-3.612 3.471 0 .688.265 1.425.595 1.826a.24.24 0 01.056.23c-.061.252-.196.796-.222.907-.035.146-.116.177-.268.107-1-.465-1.624-1.926-1.624-3.1 0-2.523 1.834-4.84 5.286-4.84 2.775 0 4.932 1.977 4.932 4.62 0 2.757-1.739 4.976-4.151 4.976-.811 0-1.573-.421-1.834-.919l-.498 1.902c-.181.695-.669 1.566-.995 2.097A12 12 0 1012 0z"/>
        </svg>
      </button>

      {/* Instagram (copy caption) — only shown on desktop where native share isn't available */}
      {!(typeof navigator !== "undefined" && navigator.share) && (
      <button onClick={handleInstagram} className={btnClass} title="Copy caption for Instagram">
        <svg className={iconClass} viewBox="0 0 24 24">
          <defs>
            <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#feda75"/>
              <stop offset="25%" stopColor="#fa7e1e"/>
              <stop offset="50%" stopColor="#d62976"/>
              <stop offset="75%" stopColor="#962fbf"/>
              <stop offset="100%" stopColor="#4f5bd5"/>
            </linearGradient>
          </defs>
          <path fill="url(#ig-grad)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
        </svg>
        {false && (
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 text-xs text-white bg-stone-800 rounded whitespace-nowrap">
            Caption copied!
          </span>
        )}
      </button>
      )}

      {/* Email */}
      <button onClick={() => setEmailOpen(true)} className={btnClass} title="Email recipe">
        <Mail className={`${iconClass} text-stone-500`} />
      </button>

      {/* Copy Link */}
      <button onClick={handleCopyLink} className={btnClass} title="Copy link">
        {copied === "link" ? (
          <Check className={`${iconClass} text-green-600`} />
        ) : (
          <Link2 className={`${iconClass} text-stone-500`} />
        )}
        {copied === "link" && (
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 text-xs text-white bg-stone-800 rounded whitespace-nowrap">
            Link copied!
          </span>
        )}
      </button>

      {/* Instagram dialog */}
      {igOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setIgOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-stone-900">Share on Instagram</h3>
              <button onClick={() => setIgOpen(false)} className="p-1 rounded hover:bg-stone-100">
                <XIcon className="size-4 text-stone-400" />
              </button>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-green-800 font-medium">Caption & hashtags copied!</p>
            </div>
            <ol className="text-sm text-stone-600 space-y-2 mb-4">
              <li><strong>1.</strong> Save the recipe photo from above (right-click → Save Image)</li>
              <li><strong>2.</strong> Open Instagram and create a new post</li>
              <li><strong>3.</strong> Upload the saved photo</li>
              <li><strong>4.</strong> Paste the caption (already in your clipboard)</li>
            </ol>
            <div className="flex gap-2">
              <button onClick={() => setIgOpen(false)} className="flex-1 py-2 text-sm font-medium text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 transition-colors">
                Done
              </button>
              <a
                href="https://www.instagram.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:from-purple-600 hover:to-pink-600 transition-colors"
              >
                Open Instagram
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Email dialog */}
      {emailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEmailOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-stone-900">Email this recipe</h3>
              <button onClick={() => setEmailOpen(false)} className="p-1 rounded hover:bg-stone-100">
                <XIcon className="size-4 text-stone-400" />
              </button>
            </div>
            <input
              type="email"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              placeholder="recipient@email.com"
              className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 mb-3"
              onKeyDown={(e) => e.key === "Enter" && handleEmailSend()}
              autoFocus
            />
            {emailResult && emailResult !== "sent" && (
              <p className="text-xs text-red-600 mb-2">{emailResult}</p>
            )}
            {emailResult === "sent" && (
              <p className="text-xs text-green-600 mb-2">Recipe sent!</p>
            )}
            <div className="flex gap-2">
              <button onClick={() => setEmailOpen(false)} className="flex-1 py-2 text-sm font-medium text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleEmailSend}
                disabled={emailSending || !emailTo.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {emailSending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                {emailSending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
