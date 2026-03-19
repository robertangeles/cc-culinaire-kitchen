/**
 * @module AppearanceTab
 *
 * Settings tab for configuring visual appearance options.
 * Supports adjusting the chat window width and height in pixels,
 * which control the dimensions of the message area and input bar.
 */

import { useState, useEffect, useRef } from "react";
import { useSiteSettings } from "../../hooks/useSiteSettings.js";
import {
  Save,
  Loader2,
  AlertCircle,
  Check,
} from "lucide-react";

/** Default chat window dimensions in pixels. */
const DEFAULT_CHAT_WIDTH = 768;
const DEFAULT_CHAT_HEIGHT = 600;
const DEFAULT_OUTPUT_WIDTH = 75;
const DEFAULT_SIDEBAR_BG = "#292524"; // stone-800

/**
 * Renders the appearance settings editor within the Settings page.
 * Provides numeric inputs for chat window width and height with
 * a live preview and save functionality.
 */
export function AppearanceTab() {
  const {
    settings,
    isLoading,
    isSaving,
    error,
    success,
    save,
  } = useSiteSettings();

  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH);
  const [chatHeight, setChatHeight] = useState(DEFAULT_CHAT_HEIGHT);
  const [outputWidth, setOutputWidth] = useState(DEFAULT_OUTPUT_WIDTH);
  const [sidebarBg, setSidebarBg] = useState(DEFAULT_SIDEBAR_BG);
  const initialized = useRef(false);

  useEffect(() => {
    if (!isLoading && !initialized.current) {
      const savedWidth = settings.chat_window_width;
      if (savedWidth) {
        const parsed = parseInt(savedWidth, 10);
        if (!isNaN(parsed) && parsed > 0) setChatWidth(parsed);
      }
      const savedHeight = settings.chat_window_height;
      if (savedHeight) {
        const parsed = parseInt(savedHeight, 10);
        if (!isNaN(parsed) && parsed > 0) setChatHeight(parsed);
      }
      const savedOutputWidth = settings.chat_output_width;
      if (savedOutputWidth) {
        const parsed = parseInt(savedOutputWidth, 10);
        if (!isNaN(parsed) && parsed > 0) setOutputWidth(parsed);
      }
      if (settings.sidebar_bg) {
        setSidebarBg(settings.sidebar_bg);
      }
      initialized.current = true;
    }
  }, [isLoading, settings]);

  async function handleSave() {
    await save({
      chat_window_width: String(chatWidth),
      chat_window_height: String(chatHeight),
      chat_output_width: String(outputWidth),
      sidebar_bg: sidebarBg,
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-[#999999]">
        <Loader2 className="size-5 animate-spin mr-2" />
        Loading settings...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-6 border-b border-[#2A2A2A]">
        <h1 className="text-xl font-semibold text-[#FAFAFA]">Appearance</h1>
        <p className="mt-1 text-sm text-[#999999]">
          Customize how the chat interface looks and feels.
        </p>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {/* Width */}
        <div>
          <label className="block text-sm font-medium text-[#E5E5E5] mb-1.5">
            Chat Window Width (px)
          </label>
          <p className="text-xs text-[#999999] mb-2">
            Controls the maximum width of the message area and input bar.
            Default is {DEFAULT_CHAT_WIDTH}px.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={chatWidth}
              onChange={(e) => setChatWidth(parseInt(e.target.value, 10) || 0)}
              min={400}
              max={1600}
              step={8}
              className="w-40 rounded-lg border border-[#2A2A2A] bg-[#1E1E1E] px-3 py-2 text-sm text-[#E5E5E5] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent"
            />
            <span className="text-xs text-[#999999]">px (400–1600)</span>
          </div>
        </div>

        {/* Height */}
        <div>
          <label className="block text-sm font-medium text-[#E5E5E5] mb-1.5">
            Chat Window Height (px)
          </label>
          <p className="text-xs text-[#999999] mb-2">
            Controls the maximum height of the message area.
            Default is {DEFAULT_CHAT_HEIGHT}px.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={chatHeight}
              onChange={(e) => setChatHeight(parseInt(e.target.value, 10) || 0)}
              min={300}
              max={1200}
              step={8}
              className="w-40 rounded-lg border border-[#2A2A2A] bg-[#1E1E1E] px-3 py-2 text-sm text-[#E5E5E5] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent"
            />
            <span className="text-xs text-[#999999]">px (300–1200)</span>
          </div>
        </div>

        {/* Chat Output Width */}
        <div>
          <label className="block text-sm font-medium text-[#E5E5E5] mb-1.5">
            Chat Output Width (%)
          </label>
          <p className="text-xs text-[#999999] mb-2">
            Controls the maximum width of each message bubble as a percentage of the chat area.
            Default is {DEFAULT_OUTPUT_WIDTH}%.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={outputWidth}
              onChange={(e) => setOutputWidth(parseInt(e.target.value, 10) || 0)}
              min={30}
              max={100}
              step={5}
              className="w-40 rounded-lg border border-[#2A2A2A] bg-[#1E1E1E] px-3 py-2 text-sm text-[#E5E5E5] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent"
            />
            <span className="text-xs text-[#999999]">% (30–100)</span>
          </div>
        </div>

        {/* Sidebar Background */}
        <div>
          <label className="block text-sm font-medium text-[#E5E5E5] mb-1.5">
            Sidebar Background Color
          </label>
          <p className="text-xs text-[#999999] mb-2">
            Hex color code for the sidebar background. Default is {DEFAULT_SIDEBAR_BG} (stone-800).
          </p>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={sidebarBg}
              onChange={(e) => setSidebarBg(e.target.value)}
              className="size-10 rounded-lg border border-[#2A2A2A] cursor-pointer p-0.5"
            />
            <input
              type="text"
              value={sidebarBg}
              onChange={(e) => setSidebarBg(e.target.value)}
              placeholder="#292524"
              maxLength={7}
              className="w-28 rounded-lg border border-[#2A2A2A] px-3 py-2 text-sm text-[#E5E5E5] font-mono bg-[#1E1E1E] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent"
            />
            <div
              className="size-10 rounded-lg border border-[#2A2A2A]"
              style={{ backgroundColor: sidebarBg }}
            />
          </div>
        </div>

        {/* Live preview */}
        <div>
          <label className="block text-sm font-medium text-[#E5E5E5] mb-1.5">
            Preview
          </label>
          <div className="border border-[#2A2A2A] rounded-lg p-4 bg-[#161616]">
            <div
              className="mx-auto bg-[#D4A574]/15 border border-[#D4A574]/30 rounded flex items-center justify-center text-xs text-[#D4A574] transition-all"
              style={{
                maxWidth: `${chatWidth}px`,
                height: `${Math.min(chatHeight / 3, 120)}px`,
              }}
            >
              {chatWidth} × {chatHeight}px
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="px-8 py-4 border-t border-[#2A2A2A] bg-[#0A0A0A] flex items-center justify-end gap-3">
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
          className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
