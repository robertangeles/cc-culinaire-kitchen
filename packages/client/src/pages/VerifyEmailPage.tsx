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
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] px-4">
      <div className="w-full max-w-md text-center">
        {status === "loading" && (
          <div className="space-y-4">
            <Loader2 className="size-12 animate-spin text-[#D4A574] mx-auto" />
            <p className="text-[#E5E5E5]">Verifying your email...</p>
          </div>
        )}

        {status === "success" && (
          <div className="bg-[#161616] rounded-2xl shadow-lg shadow-black/20 border border-[#2A2A2A] p-8 space-y-4">
            <CheckCircle2 className="size-12 text-green-400 mx-auto" />
            <h2 className="text-xl font-bold text-[#FAFAFA]">Email Verified</h2>
            <p className="text-[#E5E5E5]">{message}</p>
            <Link
              to="/login"
              className="inline-block mt-4 px-6 py-2.5 text-sm font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] transition-colors"
            >
              Go to Login
            </Link>
          </div>
        )}

        {status === "error" && (
          <div className="bg-[#161616] rounded-2xl shadow-lg shadow-black/20 border border-[#2A2A2A] p-8 space-y-4">
            <AlertCircle className="size-12 text-red-500 mx-auto" />
            <h2 className="text-xl font-bold text-[#FAFAFA]">Verification Failed</h2>
            <p className="text-[#E5E5E5]">{message}</p>
            <Link
              to="/login"
              className="inline-block mt-4 px-6 py-2.5 text-sm font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] transition-colors"
            >
              Go to Login
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
