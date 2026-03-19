/**
 * @module components/auth/PasswordRequirements
 *
 * Real-time password strength checklist that validates against
 * the same rules enforced by the server-side Zod schema.
 */

import { Check, X } from "lucide-react";

interface PasswordRequirementsProps {
  password: string;
}

const rules = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "At least one uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "At least one number", test: (p: string) => /[0-9]/.test(p) },
];

export function PasswordRequirements({ password }: PasswordRequirementsProps) {
  if (!password) return null;

  return (
    <ul className="mt-1.5 space-y-0.5">
      {rules.map((rule) => {
        const passed = rule.test(password);
        return (
          <li
            key={rule.label}
            className={`flex items-center gap-1.5 text-xs ${
              passed ? "text-emerald-400" : "text-[#666666]"
            }`}
          >
            {passed ? (
              <Check className="size-3 flex-shrink-0" />
            ) : (
              <X className="size-3 flex-shrink-0" />
            )}
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}

/** Returns true when all password rules pass. */
export function isPasswordValid(password: string): boolean {
  return rules.every((rule) => rule.test(password));
}
