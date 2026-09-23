/**
 * @module components/settings/useRuleDrawer
 *
 * Open/close + form state for the Add Rule drawer shared verbatim by
 * AwardRulesTab and ComplianceRulesTab (both built against RuleDrawer.tsx
 * in this same PR) — extracted because the two were byte-for-byte
 * identical, not because "settings tabs" in general need this shape.
 */

import { useState } from "react";

export function useRuleDrawer<T>(emptyForm: T) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<T>(emptyForm);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function openDrawer() {
    setForm(emptyForm);
    setSaveError(null);
    setOpen(true);
  }

  function closeDrawer() {
    setOpen(false);
  }

  return { open, setOpen, form, setForm, saveError, setSaveError, saving, setSaving, openDrawer, closeDrawer };
}
