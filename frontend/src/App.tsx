import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import AppLayout from "@/components/layout/AppLayout";
import { AccessRestricted, ProtectedRoute, RoleBasedRoute } from "@/components/routing/Guards";

import { LoadingOverlay } from "@/components/Primitives";

// Route-level code-splitting: loads each page asynchronously on demand
const Home = lazy(() => import("@/pages/Home"));
const AboutPlatform = lazy(() => import("@/pages/PublicPages").then(m => ({ default: m.AboutPlatform })));
const PlatformPage = lazy(() => import("@/pages/PublicPages").then(m => ({ default: m.PlatformPage })));
const LoginPage = lazy(() => import("@/pages/AuthPages").then(m => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import("@/pages/AuthPages").then(m => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => import("@/pages/AuthPages").then(m => ({ default: m.ForgotPasswordPage })));
const OAuthConsentPage = lazy(() => import("@/pages/OAuthConsentPage"));

const DashboardPage = lazy(() => import("@/pages/DashboardPages").then(m => ({ default: m.DashboardPage })));
const GISMonitoringPage = lazy(() => import("@/pages/DashboardPages").then(m => ({ default: m.GISMonitoringPage })));
const SosAlertsPage = lazy(() => import("@/pages/DashboardPages").then(m => ({ default: m.SosAlertsPage })));
const AnalyticsPage = lazy(() => import("@/pages/DashboardPages").then(m => ({ default: m.AnalyticsPage })));
const AreaDetailsPage = lazy(() => import("@/pages/DashboardPages").then(m => ({ default: m.AreaDetailsPage })));

const AlertsPage = lazy(() => import("@/pages/OpsPages").then(m => ({ default: m.AlertsPage })));
const DigitalTwinPage = lazy(() => import("@/pages/OpsPages").then(m => ({ default: m.DigitalTwinPage })));
const ProfilePage = lazy(() => import("@/pages/OpsPages").then(m => ({ default: m.ProfilePage })));
const ReportsPage = lazy(() => import("@/pages/OpsPages").then(m => ({ default: m.ReportsPage })));
const RiskAssessmentPage = lazy(() => import("@/pages/OpsPages").then(m => ({ default: m.RiskAssessmentPage })));
const SettingsPage = lazy(() => import("@/pages/OpsPages").then(m => ({ default: m.SettingsPage })));
const UserManagementPage = lazy(() => import("@/pages/OpsPages").then(m => ({ default: m.UserManagementPage })));

export default function App() {
  return (
    <>
      <Suspense fallback={<LoadingOverlay message="Loading platform module..." />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<AboutPlatform />} />
          <Route path="/platform" element={<PlatformPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/oauth/consent" element={<OAuthConsentPage />} />

          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/gis" element={<GISMonitoringPage />} />
            <Route path="/digital-twin" element={<RoleBasedRoute allow={["admin", "gov_officer"]}><DigitalTwinPage /></RoleBasedRoute>} />
            <Route path="/sos-alerts" element={<SosAlertsPage />} />
            <Route path="/environmental" element={<Navigate to="/sos-alerts" replace />} />
            <Route path="/area" element={<AreaDetailsPage />} />
            <Route path="/risk" element={<RoleBasedRoute allow={["admin", "gov_officer"]}><RiskAssessmentPage /></RoleBasedRoute>} />
            <Route path="/alerts" element={<RoleBasedRoute allow={["admin", "gov_officer", "field_officer"]}><AlertsPage /></RoleBasedRoute>} />
            <Route path="/analytics" element={<RoleBasedRoute allow={["admin", "gov_officer"]}><AnalyticsPage /></RoleBasedRoute>} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/sensors" element={<Navigate to="/dashboard" replace />} />
            <Route path="/users" element={<RoleBasedRoute allow={["admin"]}><UserManagementPage /></RoleBasedRoute>} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/403" element={<AccessRestricted />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      {/* bottom-right: top-right would overlay the notification bell and profile menu in the app header */}
      <Toaster position="bottom-right" richColors />
    </>
  );
}

