/**
 * @module pages/VerifyEmailPage
 *
 * Landing page for email verification links. Extracts the token from
 * the URL query params, calls the verification API, and shows the result.
 */

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("No verification token provided.");
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/auth/verify-email?token=${token}`);
        const data = await res.json();

        if (res.ok) {
          setStatus("success");
          setMessage(data.message);
        } else {
          setStatus("error");
          setMessage(data.error);
        }
      } catch {
        setStatus("error");
        setMessage("An error occurred. Please try again.");
      }
    })();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-md text-center">
        {status === "loading" && (
          <div className="space-y-4">
            <Loader2 className="size-12 animate-spin text-amber-600 mx-auto" />
            <p className="text-stone-600">Verifying your email...</p>
          </div>
        )}

        {status === "success" && (
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8 space-y-4">
            <CheckCircle2 className="size-12 text-green-600 mx-auto" />
            <h2 className="text-xl font-bold text-stone-800">Email Verified</h2>
            <p className="text-stone-600">{message}</p>
            <Link
              to="/login"
              className="inline-block mt-4 px-6 py-2.5 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
            >
              Go to Login
            </Link>
          </div>
        )}

        {status === "error" && (
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8 space-y-4">
            <AlertCircle className="size-12 text-red-500 mx-auto" />
            <h2 className="text-xl font-bold text-stone-800">Verification Failed</h2>
            <p className="text-stone-600">{message}</p>
            <Link
              to="/login"
              className="inline-block mt-4 px-6 py-2.5 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
            >
              Go to Login
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
