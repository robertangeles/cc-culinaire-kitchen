/**
 * @module SiteSettingsTab
 *
 * Settings tab for managing site-wide configuration: page title,
 * meta description, robots meta directive, favicon upload, logo upload,
 * and footer text. Changes are saved to the server via the settings API.
 */

import { useState, useEffect, useRef } from "react";
import { useSiteSettings } from "../../hooks/useSiteSettings.js";
import {
  Save,
  Loader2,
  AlertCircle,
  Check,
  Upload,
  Image,
} from "lucide-react";

/** Robots meta options available in the dropdown. */
const ROBOTS_OPTIONS = [
  { value: "", label: "Default (not set)" },
  { value: "index, follow", label: "Index, Follow" },
  { value: "noindex, follow", label: "No Index, Follow" },
  { value: "index, nofollow", label: "Index, No Follow" },
  { value: "noindex, nofollow", label: "No Index, No Follow" },
];

/** Available Gemini image generation models. */
const IMAGE_MODEL_OPTIONS = [
  { value: "gemini-2.0-flash-exp-image-generation", label: "Gemini 2.0 Flash (Experimental)" },
  { value: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image (Nano Banana)" },
  { value: "gemini-3.1-flash-image-preview", label: "Gemini 3.1 Flash Image (Nano Banana 2)" },
];

/**
 * Renders the site-settings editor within the Settings page.
 * Provides form fields for SEO metadata, file uploads for favicon/logo,
 * and a footer text field. All changes are batched and saved together.
 */
export function SiteSettingsTab() {
  const {
    settings,
    isLoading,
    isSaving,
    error,
    success,
    save,
    uploadFile,
  } = useSiteSettings();

  const [form, setForm] = useState({
    page_title: "",
    title_separator: "",
    tagline: "",
    meta_description: "",
    robots_meta: "",
    favicon_path: "",
    logo_path: "",
    footer_text: "",
    web_search_enabled: "false",
    image_generation_enabled: "false",
    image_generation_model: "gemini-2.0-flash-exp-image-generation",
    guest_session_idle_hours: "24",
  });

  /** Track whether the form has been initialized from settings. */
  const initialized = useRef(false);

  useEffect(() => {
    if (!isLoading && !initialized.current) {
      setForm({
        page_title: settings.page_title ?? "",
        title_separator: settings.title_separator ?? "|",
        tagline: settings.tagline ?? "",
        meta_description: settings.meta_description ?? "",
        robots_meta: settings.robots_meta ?? "",
        favicon_path: settings.favicon_path ?? "",
        logo_path: settings.logo_path ?? "",
        footer_text: settings.footer_text ?? "",
        web_search_enabled: settings.web_search_enabled ?? "false",
        image_generation_enabled: settings.image_generation_enabled ?? "false",
        image_generation_model: settings.image_generation_model ?? "gemini-2.0-flash-exp-image-generation",
        guest_session_idle_hours: settings.guest_session_idle_hours ?? "24",
      });
      initialized.current = true;
    }
  }, [isLoading, settings]);

  /** Update a single form field. */
  function updateField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /** Handle image upload for favicon or logo. */
  async function handleFileUpload(
    field: "favicon_path" | "logo_path",
    file: File
  ) {
    const path = await uploadFile(file);
    if (path) {
      updateField(field, path);
    }
  }

  /** Save all form values to the server. */
  async function handleSave() {
    await save(form);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-stone-400">
        <Loader2 className="size-5 animate-spin mr-2" />
        Loading settings...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-6 border-b border-stone-200">
        <h1 className="text-xl font-semibold text-stone-900">Site Settings</h1>
        <p className="mt-1 text-sm text-stone-500">
          Configure page metadata, branding assets, and footer content.
        </p>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {/* Page Title */}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1.5">
            Page Title
          </label>
          <input
            type="text"
            value={form.page_title}
            onChange={(e) => updateField("page_title", e.target.value)}
            placeholder="CulinAIre Kitchen"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          />
        </div>

        {/* Title Separator */}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1.5">
            Title Separator
          </label>
          <p className="text-xs text-stone-400 mb-2">
            Character(s) between the page title and tagline in the browser tab.
          </p>
          <input
            type="text"
            value={form.title_separator}
            onChange={(e) => updateField("title_separator", e.target.value)}
            placeholder="|"
            className="w-24 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 text-center focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          />
        </div>

        {/* Tagline */}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1.5">
            Tagline
          </label>
          <input
            type="text"
            value={form.tagline}
            onChange={(e) => updateField("tagline", e.target.value)}
            placeholder="Your AI Culinary Knowledge Engine"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          />
        </div>

        {/* Title Preview */}
        {(form.page_title || form.tagline) && (
          <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
            <span className="text-xs font-medium text-stone-500 block mb-1">
              Browser Tab Preview
            </span>
            <span className="text-sm text-stone-800">
              {[form.page_title, form.tagline]
                .filter(Boolean)
                .join(` ${form.title_separator || "|"} `)}
            </span>
          </div>
        )}

        {/* Meta Description */}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1.5">
            Meta Description
          </label>
          <textarea
            value={form.meta_description}
            onChange={(e) => updateField("meta_description", e.target.value)}
            placeholder="AI-powered culinary knowledge engine for chefs and food professionals."
            rows={2}
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 resize-none focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          />
        </div>

        {/* Robots Meta */}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1.5">
            Robots Meta
          </label>
          <select
            value={form.robots_meta}
            onChange={(e) => updateField("robots_meta", e.target.value)}
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          >
            {ROBOTS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Favicon Upload */}
        <FileUploadField
          label="Favicon"
          currentPath={form.favicon_path}
          onUpload={(file) => handleFileUpload("favicon_path", file)}
          accept=".png,.ico,.svg"
        />

        {/* Logo Upload */}
        <FileUploadField
          label="Site Logo"
          currentPath={form.logo_path}
          onUpload={(file) => handleFileUpload("logo_path", file)}
          accept=".png,.jpg,.jpeg,.svg,.webp"
        />

        {/* Footer Text */}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1.5">
            Footer Text
          </label>
          <input
            type="text"
            value={form.footer_text}
            onChange={(e) => updateField("footer_text", e.target.value)}
            placeholder="© 2026 CulinAIre Kitchen"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          />
        </div>

        {/* AI Features */}
        <div className="border-t border-stone-200 pt-6">
          <h2 className="text-sm font-semibold text-stone-800 uppercase tracking-wider mb-4">
            AI Features
          </h2>

          {/* Web Search Toggle */}
          <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-white px-4 py-3">
            <div>
              <div className="text-sm font-medium text-stone-800">
                Enable Web Search
              </div>
              <p className="text-xs text-stone-500 mt-0.5">
                Allow the AI assistant to search the web for current information
                beyond the curated knowledge base. Requires the Anthropic provider.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.web_search_enabled === "true"}
              onClick={() =>
                updateField(
                  "web_search_enabled",
                  form.web_search_enabled === "true" ? "false" : "true"
                )
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 ${
                form.web_search_enabled === "true"
                  ? "bg-amber-600"
                  : "bg-stone-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  form.web_search_enabled === "true"
                    ? "translate-x-6"
                    : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {/* Image Generation Toggle */}
          <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-white px-4 py-3 mt-3">
            <div>
              <div className="text-sm font-medium text-stone-800">
                Enable Image Generation
              </div>
              <p className="text-xs text-stone-500 mt-0.5">
                Allow users to generate images using the Nano Banana model
                (Google Gemini API). Requires GEMINI_API_KEY to be configured.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.image_generation_enabled === "true"}
              onClick={() =>
                updateField(
                  "image_generation_enabled",
                  form.image_generation_enabled === "true" ? "false" : "true"
                )
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 ${
                form.image_generation_enabled === "true"
                  ? "bg-amber-600"
                  : "bg-stone-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  form.image_generation_enabled === "true"
                    ? "translate-x-6"
                    : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {/* Image Generation Model Selector */}
          {form.image_generation_enabled === "true" && (
            <div className="rounded-lg border border-stone-200 bg-white px-4 py-3 mt-3">
              <label className="block text-sm font-medium text-stone-800 mb-1">
                Image Generation Model
              </label>
              <p className="text-xs text-stone-500 mb-2">
                Select the Gemini model used for image generation.
              </p>
              <select
                value={form.image_generation_model}
                onChange={(e) =>
                  updateField("image_generation_model", e.target.value)
                }
                className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              >
                {IMAGE_MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* ── Guest Sessions ─────────────────────────────── */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wide">
            Guest Sessions
          </h2>

          {/* Idle session cleanup hours */}
          <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-white px-4 py-3">
            <div>
              <div className="text-sm font-medium text-stone-800">
                Session Idle Timeout (hours)
              </div>
              <p className="text-xs text-stone-500 mt-0.5">
                Guest sessions inactive for longer than this are automatically
                deleted, freeing up the per-IP session limit.
              </p>
            </div>
            <input
              type="number"
              min="1"
              max="720"
              value={form.guest_session_idle_hours}
              onChange={(e) =>
                updateField("guest_session_idle_hours", e.target.value)
              }
              className="w-20 rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-sm text-stone-800 text-right focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="px-8 py-4 border-t border-stone-200 bg-stone-50 flex items-center justify-end gap-3">
        {error && (
          <span className="flex items-center gap-1.5 text-sm text-red-600">
            <AlertCircle className="size-4" />
            {error}
          </span>
        )}
        {success && (
          <span className="flex items-center gap-1.5 text-sm text-green-600">
            <Check className="size-4" />
            {success}
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Save
        </button>
      </div>
    </div>
  );
}

/**
 * Reusable file upload field with preview for image assets.
 */
function FileUploadField({
  label,
  currentPath,
  onUpload,
  accept,
}: {
  label: string;
  currentPath: string;
  onUpload: (file: File) => void;
  accept: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 mb-1.5">
        {label}
      </label>
      <div className="flex items-center gap-4">
        {/* Preview */}
        <div className="size-12 rounded-lg border border-stone-200 bg-stone-50 flex items-center justify-center overflow-hidden">
          {currentPath ? (
            <img
              src={currentPath}
              alt={label}
              className="size-full object-contain"
            />
          ) : (
            <Image className="size-5 text-stone-300" />
          )}
        </div>

        {/* Upload button */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 px-3 py-2 text-sm text-stone-600 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors"
        >
          <Upload className="size-4" />
          Upload
        </button>

        {currentPath && (
          <span className="text-xs text-stone-400 truncate max-w-48">
            {currentPath}
          </span>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
          }}
        />
      </div>
    </div>
  );
}
