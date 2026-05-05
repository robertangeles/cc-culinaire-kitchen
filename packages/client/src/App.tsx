/**
 * @module App
 *
 * Root component for the CulinAIre Kitchen client. Sets up client-side
 * routing, authentication, and the top-level page layout.
 */

import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router";
import { createContext, useContext, useState, lazy, Suspense } from "react";
import { SettingsProvider } from "./context/SettingsContext.js";
import { AuthProvider, useAuth } from "./context/AuthContext.js";
import { ConversationProvider } from "./context/ConversationContext.js";
import { ChatStreamProvider } from "./context/ChatStreamContext.js";
import { ProtectedRoute } from "./components/auth/ProtectedRoute.js";
import { BackgroundStreamBanner } from "./components/chat/BackgroundStreamBanner.js";
import { Sidebar } from "./components/layout/Sidebar.js";
import { ConversationSidebar } from "./components/layout/ConversationSidebar.js";
import { GuideSidebar } from "./components/layout/GuideSidebar.js";
import { GuideProvider } from "./context/GuideContext.js";
import { KitchenOpsLayout } from "./components/layout/KitchenOpsLayout.js";
import { Footer } from "./components/layout/Footer.js";
import { ChatPage } from "./pages/ChatPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { PublicPage } from "./components/legal/PublicPage.js";
import { RegisterPage } from "./pages/RegisterPage.js";
import { VerifyEmailPage } from "./pages/VerifyEmailPage.js";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage.js";
import { ResetPasswordPage } from "./pages/ResetPasswordPage.js";
import { MfaSetupPage } from "./pages/MfaSetupPage.js";
import { ProfilePage } from "./pages/ProfilePage.js";
import { RecipeLabPage } from "./pages/RecipeLabPage.js";
import { RecipeGalleryPage } from "./pages/RecipeGalleryPage.js";
import { RecipeDetailPage } from "./pages/RecipeDetailPage.js";
import { MyShelfPage } from "./pages/MyShelfPage.js";
import { BenchPage } from "./pages/BenchPage.js";
import { MenuIntelligencePage } from "./pages/MenuIntelligencePage.js";
import { WasteIntelligencePage } from "./pages/WasteIntelligencePage.js";
import { KitchenCopilotPage } from "./pages/KitchenCopilotPage.js";
import { InventoryPage } from "./pages/InventoryPage.js";
import { PurchasingPage } from "./pages/PurchasingPage.js";
import { KitchenOnboarding } from "./components/onboarding/KitchenOnboarding.js";
import { LocationProvider } from "./context/LocationContext.js";
import { LocationSwitcher } from "./components/location/LocationSwitcher.js";
import { LocationGate } from "./components/location/LocationGate.js";

const LandingPage = lazy(() => import("./pages/LandingPage.js"));

/**
 * Context that lets any component force a fresh ChatPage remount on "/chat/new".
 * Incrementing chatKey changes the `key` prop on the ChatPage element, which
 * unmounts and remounts it even if the URL is already "/chat/new".
 */
const ChatKeyContext = createContext<{ chatKey: number; incrementChatKey: () => void }>({
  chatKey: 0,
  incrementChatKey: () => {},
});
export function useChatKey() {
  return useContext(ChatKeyContext);
}

/**
 * Wrapper rendered by the "/chat/new" route. Reads chatKey from context so
 * that when incrementChatKey() is called, this component re-renders via
 * context subscription and passes the new key to ChatPage, forcing a remount.
 */
function NewChatPage() {
  const { chatKey } = useChatKey();
  return <ChatPage key={chatKey} />;
}

/** Redirects guest users to chat — used for routes that require full auth. */
function AuthenticatedOnly({ children }: { children: React.ReactNode }) {
  const { isGuest, isAuthenticated } = useAuth();
  if (isGuest && !isAuthenticated) {
    return <Navigate to="/chat/new" replace />;
  }
  return <>{children}</>;
}

/**
 * Application root. Wraps all pages in providers and renders
 * a persistent sidebar alongside the routed page content.
 *
 * Public routes: /login, /register
 * Protected routes: /chat/*, /settings
 */
/** Shows ConversationSidebar only on chat routes. */
function ChatOnlySidebar() {
  const { pathname } = useLocation();
  if (!pathname.startsWith("/chat")) return null;
  return <ConversationSidebar />;
}

/** Shows GuideSidebar on Intelligence + Inventory routes. */
function IntelligenceGuideSidebar() {
  const { pathname } = useLocation();
  const hasGuide =
    pathname.startsWith("/waste-intelligence") ||
    pathname.startsWith("/kitchen-copilot") ||
    pathname.startsWith("/menu-intelligence") ||
    pathname.startsWith("/inventory");
  if (!hasGuide) return null;
  return <GuideSidebar />;
}

export function App() {
  const [chatKey, setChatKey] = useState(0);
  const incrementChatKey = () => setChatKey((k) => k + 1);

  return (
    <ChatKeyContext.Provider value={{ chatKey, incrementChatKey }}>
      <BrowserRouter>
        <SettingsProvider>
          <AuthProvider>
            <LocationProvider>
            <Routes>
              {/* Public routes (no sidebar) */}
              <Route path="/" element={<Suspense fallback={<div className="min-h-screen bg-dark" />}><LandingPage /></Suspense>} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />

              {/* Public site_page routes */}
              <Route path="/terms" element={<PublicPage slug="terms" surface="mobile" />} />
              <Route path="/privacy" element={<PublicPage slug="privacy" surface="mobile" />} />
              <Route path="/pages/:slug" element={<PublicPage />} />

              {/* Protected app routes (with sidebar + footer) */}
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <ChatStreamProvider>
                    <ConversationProvider>
                    <GuideProvider>
                    <div className="flex h-screen overflow-hidden bg-stone-50">
                      {/* Kitchen onboarding wizard — shown once to new users */}
                      <KitchenOnboarding />
                      {/* Ctrl+L location switcher overlay */}
                      <LocationSwitcher />
                      {/* Slim icon rail — branding, new chat, settings, user */}
                      <Sidebar />
                      {/* Main content area */}
                      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                        <BackgroundStreamBanner />
                        <Routes>
                          <Route path="/chat/new" element={<NewChatPage />} />
                          <Route path="/chat/:id" element={<ChatPage />} />
                          <Route path="/settings" element={<AuthenticatedOnly><SettingsPage /></AuthenticatedOnly>} />
                          <Route path="/profile" element={<AuthenticatedOnly><ProfilePage /></AuthenticatedOnly>} />
                          <Route path="/mfa-setup" element={<AuthenticatedOnly><MfaSetupPage /></AuthenticatedOnly>} />
                          <Route path="/recipes" element={<RecipeLabPage key="recipe" domain="recipe" />} />
                          <Route path="/patisserie" element={<RecipeLabPage key="patisserie" domain="patisserie" />} />
                          <Route path="/spirits" element={<RecipeLabPage key="spirits" domain="spirits" />} />
                          <Route path="/my-shelf" element={<AuthenticatedOnly><MyShelfPage /></AuthenticatedOnly>} />
                          <Route path="/menu-intelligence" element={<AuthenticatedOnly><LocationGate><KitchenOpsLayout><MenuIntelligencePage /></KitchenOpsLayout></LocationGate></AuthenticatedOnly>} />
                          <Route path="/waste-intelligence" element={<AuthenticatedOnly><LocationGate><KitchenOpsLayout><WasteIntelligencePage /></KitchenOpsLayout></LocationGate></AuthenticatedOnly>} />
                          <Route path="/kitchen-copilot" element={<AuthenticatedOnly><LocationGate><KitchenOpsLayout><KitchenCopilotPage /></KitchenOpsLayout></LocationGate></AuthenticatedOnly>} />
                          <Route path="/inventory" element={<AuthenticatedOnly><LocationGate><KitchenOpsLayout><InventoryPage /></KitchenOpsLayout></LocationGate></AuthenticatedOnly>} />
                          <Route path="/purchasing" element={<AuthenticatedOnly><LocationGate><KitchenOpsLayout><PurchasingPage /></KitchenOpsLayout></LocationGate></AuthenticatedOnly>} />
                          <Route path="/bench" element={<BenchPage />} />
                          <Route path="/kitchen-shelf" element={<RecipeGalleryPage />} />
                          <Route path="/kitchen-shelf/:id" element={<RecipeDetailPage />} />
                        </Routes>
                        <Footer />
                      </main>
                      {/* Right sidebar — conversation history (chat pages only) */}
                      <ChatOnlySidebar />
                      {/* Right sidebar — guide content (Intelligence pages only) */}
                      <IntelligenceGuideSidebar />
                    </div>
                    </GuideProvider>
                    </ConversationProvider>
                    </ChatStreamProvider>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </LocationProvider>
          </AuthProvider>
        </SettingsProvider>
      </BrowserRouter>
    </ChatKeyContext.Provider>
  );
}
