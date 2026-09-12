import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import {
  ShieldCheck,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Globe,
  ExternalLink,
  User,
  ArrowRight,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { toast } from "sonner";

interface ClientDetails {
  client: {
    id?: string;
    name: string;
    uri?: string;
    logo_uri?: string;
  };
  scope: string;
  redirect_uri?: string;
  authorization_id?: string;
}

const SCOPE_DESCRIPTIONS: Record<string, { label: string; desc: string }> = {
  openid: {
    label: "Verify your identity",
    desc: "Confirms your unique account ID and official profile status.",
  },
  email: {
    label: "View your email address",
    desc: "Allows this application to read your registered official government email address.",
  },
  profile: {
    label: "Access profile details",
    desc: "Includes your name, designation, department, and assigned monitoring jurisdiction.",
  },
  offline_access: {
    label: "Offline / Refresh access",
    desc: "Allows the client to refresh tokens and maintain access when you are offline.",
  },
};

export default function OAuthConsentPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user: appUser, isLoading: sessionLoading } = useSession();

  const authorizationId = searchParams.get("authorization_id");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [authDetails, setAuthDetails] = useState<ClientDetails | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  useEffect(() => {
    async function loadAuthorization() {
      // 1. If no authorization_id provided, display interactive preview/testing mode
      if (!authorizationId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorMessage(null);

      try {
        // Check current Supabase auth session
        const { data: userData } = await supabase.auth.getUser();
        const email = userData.user?.email || appUser?.email;

        if (!email) {
          // Redirect to login preserving authorization_id
          const returnTo = `${window.location.pathname}${window.location.search}`;
          navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
          return;
        }

        setCurrentUserEmail(email);

        // Fetch OAuth authorization details from Supabase
        const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

        if (error) {
          setErrorMessage(error.message || "Failed to load authorization request details.");
          setLoading(false);
          return;
        }

        if (!data) {
          setErrorMessage("No authorization details returned by the OAuth server.");
          setLoading(false);
          return;
        }

        // If user already previously consented, Supabase returns redirect_url directly
        if ("redirect_url" in data && data.redirect_url) {
          toast.info("Authorization already granted. Redirecting...");
          window.location.href = data.redirect_url;
          return;
        }

        if ("authorization_id" in data) {
          setAuthDetails(data as ClientDetails);
        } else {
          setAuthDetails(data as unknown as ClientDetails);
        }
      } catch (err: any) {
        setErrorMessage(err?.message || "An error occurred while loading the authorization request.");
      } finally {
        setLoading(false);
      }
    }

    if (!sessionLoading) {
      loadAuthorization();
    }
  }, [authorizationId, sessionLoading, appUser, navigate]);

  const handleApprove = async () => {
    if (!authorizationId) {
      toast.success("Simulation: Authorization approved! (Preview mode)");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationId);
      if (error) {
        toast.error(error.message || "Failed to approve authorization.");
        setSubmitting(false);
        return;
      }

      if (data?.redirect_url) {
        toast.success("Authorization approved! Redirecting to application...");
        window.location.href = data.redirect_url;
      } else {
        toast.error("No redirect URL returned by authorization server.");
        setSubmitting(false);
      }
    } catch (err: any) {
      toast.error(err?.message || "Error approving authorization.");
      setSubmitting(false);
    }
  };

  const handleDeny = async () => {
    if (!authorizationId) {
      toast.info("Simulation: Authorization denied. (Preview mode)");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationId);
      if (error) {
        toast.error(error.message || "Failed to deny authorization.");
        setSubmitting(false);
        return;
      }

      if (data?.redirect_url) {
        toast.info("Authorization denied. Returning to application...");
        window.location.href = data.redirect_url;
      } else {
        navigate("/dashboard", { replace: true });
      }
    } catch (err: any) {
      toast.error(err?.message || "Error denying authorization.");
      setSubmitting(false);
    }
  };

  const scopesList = authDetails?.scope
    ? authDetails.scope.split(" ").filter(Boolean)
    : ["openid", "email", "profile"];

  const effectiveEmail = currentUserEmail || appUser?.email || "officer@ein.gov.in";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100/80 text-slate-900 flex flex-col justify-between">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur-md px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-[#0B2545] text-white shadow-sm">
              <ShieldCheck className="size-5" />
            </span>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-700">
                Environmental Intelligence Network
              </div>
              <div className="text-xs font-semibold text-slate-800">
                Supabase OAuth 2.1 Identity Server
              </div>
            </div>
          </div>
          <Badge variant="outline" className="bg-sky-50 text-sky-800 border-sky-200 gap-1.5 py-1">
            <Lock className="size-3" />
            OAuth 2.1 Authorized Path
          </Badge>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-xl">
          {loading ? (
            <Card className="p-8 text-center bg-white shadow-lg border-slate-200">
              <div className="flex flex-col items-center gap-4">
                <div className="size-10 rounded-full border-2 border-sky-600 border-t-transparent animate-spin" />
                <p className="text-sm font-medium text-slate-600">Verifying authorization request...</p>
              </div>
            </Card>
          ) : errorMessage ? (
            <Card className="p-8 bg-white shadow-lg border-red-200">
              <div className="flex items-start gap-4">
                <div className="size-10 rounded-full bg-red-100 text-red-600 grid place-items-center shrink-0">
                  <AlertTriangle className="size-5" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-bold text-slate-900">Authorization Request Error</h2>
                  <p className="mt-1 text-sm text-slate-600">{errorMessage}</p>
                  <div className="mt-6 flex gap-3">
                    <Link to="/login">
                      <Button variant="outline" size="sm">
                        Go to Sign In
                      </Button>
                    </Link>
                    <Link to="/dashboard">
                      <Button size="sm">Return to Dashboard</Button>
                    </Link>
                  </div>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-6 sm:p-8 bg-white shadow-xl border-slate-200/90 rounded-2xl">
              {/* Preview Banner if no active ID */}
              {!authorizationId && (
                <div className="mb-6 rounded-xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-900 flex items-start gap-3">
                  <Info className="size-4 shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <span className="font-bold">OAuth Server Authorization UI (Preview Mode)</span>
                    <p className="mt-0.5 text-amber-800">
                      This page implements the Supabase OAuth 2.1 Consent Screen at{" "}
                      <code className="bg-amber-100/80 px-1 py-0.5 rounded font-mono text-[11px]">
                        /oauth/consent
                      </code>
                      . When an external client initiates authorization, Supabase provides an{" "}
                      <code className="bg-amber-100/80 px-1 py-0.5 rounded font-mono text-[11px]">
                        authorization_id
                      </code>{" "}
                      parameter to display live client details.
                    </p>
                  </div>
                </div>
              )}

              {/* App Request Info */}
              <div className="text-center pb-6 border-b border-slate-100">
                <div className="mx-auto size-16 rounded-2xl bg-gradient-to-tr from-[#0F4C81] to-[#1E3A5F] text-white grid place-items-center shadow-md mb-3">
                  {authDetails?.client?.logo_uri ? (
                    <img
                      src={authDetails.client.logo_uri}
                      alt={authDetails.client.name}
                      className="size-12 rounded-xl object-contain"
                    />
                  ) : (
                    <Globe className="size-8 text-sky-200" />
                  )}
                </div>

                <h1 className="text-xl font-bold text-slate-900">
                  {authDetails?.client?.name || "Third-Party Application"}
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  is requesting permission to access your Environmental Intelligence account.
                </p>

                {authDetails?.client?.uri && (
                  <a
                    href={authDetails.client.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-sky-700 hover:underline"
                  >
                    <span>{authDetails.client.uri}</span>
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </div>

              {/* Current User Pill */}
              <div className="my-5 rounded-xl bg-slate-50 border border-slate-200/80 p-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="size-8 rounded-full bg-sky-100 text-sky-800 grid place-items-center font-bold text-xs">
                    <User className="size-4" />
                  </span>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">{effectiveEmail}</div>
                    <div className="text-[11px] text-slate-500">
                      {appUser?.designation || "Authorized Officer"}
                    </div>
                  </div>
                </div>
                <Link
                  to={`/login?returnTo=${encodeURIComponent(
                    window.location.pathname + window.location.search
                  )}`}
                  className="text-xs font-medium text-sky-700 hover:underline"
                >
                  Switch account
                </Link>
              </div>

              {/* Requested Permissions / Scopes */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Requested Permissions
                  </h2>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {scopesList.length} permissions
                  </span>
                </div>

                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/80 bg-white">
                  {scopesList.map((scope) => {
                    const desc = SCOPE_DESCRIPTIONS[scope] || {
                      label: `Permission: ${scope}`,
                      desc: `Grants access to ${scope} resource scope on the platform.`,
                    };
                    return (
                      <div key={scope} className="p-3.5 flex items-start gap-3">
                        <CheckCircle2 className="size-4 text-emerald-600 mt-0.5 shrink-0" />
                        <div>
                          <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                            {desc.label}
                            <code className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded font-mono">
                              {scope}
                            </code>
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">{desc.desc}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Security Notice */}
              <div className="mt-5 rounded-lg bg-sky-50/70 border border-sky-100 p-3 text-xs text-slate-600 flex items-start gap-2.5">
                <ShieldCheck className="size-4 text-sky-700 mt-0.5 shrink-0" />
                <p>
                  By authorizing, you allow this application to use your information in accordance
                  with their terms and privacy policies. You can revoke access at any time in your
                  profile settings.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full sm:w-1/2 border-slate-300 text-slate-700 hover:bg-slate-100"
                  onClick={handleDeny}
                  disabled={submitting}
                >
                  Deny
                </Button>
                <Button
                  size="lg"
                  className="w-full sm:w-1/2 bg-[#0F4C81] hover:bg-[#0c3c66] text-white shadow-md gap-2"
                  onClick={handleApprove}
                  disabled={submitting}
                >
                  {submitting ? "Processing..." : "Authorize Access"}
                  {!submitting && <ArrowRight className="size-4" />}
                </Button>
              </div>
            </Card>
          )}

          {/* Footer Information */}
          <div className="mt-6 text-center text-xs text-slate-500 space-y-1">
            <p>Protected by Supabase OAuth 2.1 Identity Server</p>
            <p className="font-mono text-[11px] text-slate-400">
              OIDC Discovery:{" "}
              <a
                href="https://pffdafhrhtevdboxqztn.supabase.co/auth/v1/.well-known/openid-configuration"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-slate-600"
              >
                /.well-known/openid-configuration
              </a>
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white/70 py-3 text-center text-[11px] text-slate-500">
        Flash Flood &amp; Environmental Intelligence Network © 2026 · Ministry of Environment &amp;
        Disaster Management
      </footer>
    </div>
  );
}
