import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ShieldCheck, TriangleAlert, Lock } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiPost } from "@/lib/api";
import { apiErrorMessage, useSessionActions } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { RegisterResponse, User } from "@/lib/types";

function AuthVisual({ heading, sub }: { heading: string; sub: string }) {
  return (
    <div className="relative hidden overflow-hidden bg-[#0B2545] p-10 lg:flex lg:flex-col lg:justify-between" data-testid="auth-visual">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-white/10 text-white">
          <ShieldCheck className="size-5" />
        </span>
        <span>
          <span className="block text-[11px] font-bold uppercase tracking-[0.2em] text-sky-300">Environmental</span>
          <span className="block text-[13px] font-bold uppercase tracking-[0.14em] text-white">Intelligence Network</span>
        </span>
      </div>

      <svg viewBox="0 0 420 320" className="my-8 w-full ein-animated" role="img" aria-label="GIS sensor network illustration">
        <defs>
          <pattern id="authGrid" width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1E3A5F" strokeWidth="0.7" />
          </pattern>
        </defs>
        <rect width="420" height="320" fill="url(#authGrid)" opacity="0.7" />
        <path d="M0 210 L80 150 L160 190 L250 130 L330 180 L420 140 L420 320 L0 320 Z" fill="#12456F" />
        <path d="M0 252 L90 206 L190 244 L290 200 L380 246 L420 226 L420 320 L0 320 Z" fill="#1B4D3E" opacity="0.9" />
        {[[70, 236], [170, 214], [300, 226], [380, 210]].map(([x, y], i) => (
          <g key={i}>
            <path d={`M ${x} ${y} Q ${(x + 210) / 2} ${y - 70} 210 96`} fill="none" stroke="#1E5A8A" strokeWidth="1" />
            <path d={`M ${x} ${y} Q ${(x + 210) / 2} ${y - 70} 210 96`} fill="none" stroke="#38BDF8" strokeWidth="2" strokeDasharray="8 180" style={{ animation: `ein-packet 2.8s linear ${i * 0.5}s infinite` }} />
            <circle cx={x} cy={y} r="9" fill="#0B2545" stroke="#38BDF8" strokeWidth="1.3" />
            <circle cx={x} cy={y} r="3" fill="#22C55E" />
          </g>
        ))}
        {[0, 1].map((i) => (
          <circle key={i} cx="210" cy="96" r="16" fill="none" stroke="#06B6D4" strokeWidth="1.3" style={{ animation: `ein-wave 3.2s ease-out ${i * 1.4}s infinite` }} />
        ))}
        <circle cx="210" cy="96" r="18" fill="#0B2545" stroke="#06B6D4" strokeWidth="2" />
        <path d="M201 102 L210 86 L219 102" fill="none" stroke="#67E8F9" strokeWidth="2" strokeLinecap="round" />
        <text x="210" y="66" textAnchor="middle" fill="#A5F3FC" fontSize="10" fontWeight="600" letterSpacing="1">LoRaWAN GATEWAY</text>
      </svg>

      <div>
        <h2 className="text-xl font-bold text-white">{heading}</h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-400">{sub}</p>
        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Restricted system · Access logged &amp; audited</p>
      </div>
    </div>
  );
}

function AuthFrame({ children, visual }: { children: React.ReactNode; visual: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F7F9FC]">
      <div className="mx-auto grid min-h-screen max-w-6xl overflow-hidden lg:grid-cols-2 lg:gap-0">
        {visual}
        <div className="flex items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { beginSession } = useSessionActions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});

  const authId = searchParams.get("authorization_id");
  const rawReturnTo = searchParams.get("returnTo") || searchParams.get("redirect");
  const returnTo = authId
    ? `/oauth/consent?authorization_id=${encodeURIComponent(authId)}`
    : rawReturnTo || "/dashboard";

  // Check and exchange active Supabase OAuth session on redirect or state change
  useEffect(() => {
    let mounted = true;

    const checkExistingSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token && mounted) {
        try {
          const user = await apiPost<User>("/auth/supabase-session", {
            access_token: data.session.access_token,
          });
          await beginSession(user);
          toast.success(`Welcome back, ${user.first_name}!`);
          navigate(returnTo, { replace: true });
        } catch (err) {
          // Token may have expired or not synced yet, keep login available
        }
      }
    };

    checkExistingSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if ((event === "SIGNED_IN" || event === "USER_UPDATED") && session?.access_token && mounted) {
        try {
          const user = await apiPost<User>("/auth/supabase-session", {
            access_token: session.access_token,
          });
          await beginSession(user);
          toast.success(`Welcome, ${user.first_name}!`);
          navigate(returnTo, { replace: true });
        } catch (err: any) {
          const detail = err?.body?.detail ?? err?.message ?? "OAuth sign-in failed.";
          setErrors({ form: typeof detail === "string" ? detail : "OAuth sign-in failed." });
        }
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [returnTo, navigate, beginSession]);

  const login = useMutation({
    mutationFn: async () => {
      // Parallel login to Supabase auth client for OAuth/Consent parity
      try {
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
      } catch {
        // Fallback gracefully to backend auth
      }

      return apiPost<User>("/auth/login", {
        email: email.trim(),
        password,
      });
    },
    onSuccess: async (user) => {
      await beginSession(user);
      toast.success(`Welcome back, ${user.first_name}`);
      navigate(returnTo, { replace: true });
    },
    onError: (err: any) => {
      const detail = err?.body?.detail ?? err?.message ?? "Unable to sign in.";
      setErrors({ form: typeof detail === "string" ? detail : "Unable to sign in." });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!email.includes("@")) next.email = "Enter a valid official email address.";
    if (password.length < 1) next.password = "Password is required.";
    setErrors(next);
    if (Object.keys(next).length === 0) login.mutate();
  };

  const handleOAuthSignIn = async (provider: "google" | "github" | "azure") => {
    setOauthLoading(provider);
    try {
      const redirectTo = `${window.location.origin}/login?returnTo=${encodeURIComponent(returnTo)}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider as any,
        options: {
          redirectTo,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });
      if (error) {
        toast.error(error.message || `Failed to sign in with ${provider}`);
      }
    } catch (err: any) {
      toast.error(err?.message || `OAuth sign-in error with ${provider}`);
    } finally {
      setOauthLoading(null);
    }
  };

  const handleFillDemo = (demoEmail = "test@gmail.com", demoPass = "12345678") => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setErrors({});
    toast.success(`Demo credentials filled: ${demoEmail}`);
  };

  return (
    <AuthFrame visual={<AuthVisual heading="Environmental intelligence, one operational picture" sub="Live LoRaWAN telemetry, GIS hazard mapping and AI risk scoring for authorized government officials." />}>
      <Card className="border-slate-200/80 p-8 shadow-sm" data-testid="login-card">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Welcome Back</h1>
        <p className="mt-1.5 text-sm text-slate-600">Sign in to access the Environmental Intelligence Platform.</p>

        {errors.form ? (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" data-testid="login-error-alert">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{errors.form}</span>
          </div>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={submit} noValidate data-testid="login-form">
          <div>
            <Label htmlFor="email">Email Address</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="officer@ein.gov.in" className="mt-1.5" data-testid="login-email-input" />
            {errors.email ? <p className="mt-1 text-xs text-red-700" data-testid="login-email-error">{errors.email}</p> : null}
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="mt-1.5" data-testid="login-password-input" />
            {errors.password ? <p className="mt-1 text-xs text-red-700" data-testid="login-password-error">{errors.password}</p> : null}
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <Checkbox checked={remember} onCheckedChange={(v) => setRemember(Boolean(v))} data-testid="login-remember-checkbox" />
              Remember me
            </label>
            <Link to="/forgot-password" className="text-sm font-medium text-[#0F4C81] hover:underline" data-testid="login-forgot-link">
              Forgot Password?
            </Link>
          </div>
          <Button type="submit" size="lg" className="w-full bg-[#0F4C81] hover:bg-[#0d3f6c]" disabled={login.isPending} data-testid="login-submit-btn">
            {login.isPending ? "Signing in…" : "SIGN IN WITH CREDENTIALS"}
          </Button>
        </form>

        <div className="my-6 flex items-center gap-3">
          <span className="h-px flex-1 bg-slate-200" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">OR SIGN IN WITH OAUTH</span>
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        {/* OAuth Buttons */}
        <div className="space-y-2.5">
          <Button
            variant="outline"
            size="lg"
            className="w-full flex items-center justify-center gap-2.5 border-slate-300 hover:bg-slate-50 text-slate-700"
            onClick={() => handleOAuthSignIn("google")}
            disabled={oauthLoading !== null}
            data-testid="login-oauth-google-btn"
          >
            <svg className="size-4" viewBox="0 0 24 24">
              <path
                fill="#EA4335"
                d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.9C6.2 7.2 8.9 5 12 5z"
              />
              <path
                fill="#4285F4"
                d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"
              />
              <path
                fill="#FBBC05"
                d="M5.3 14.7c-.2-.7-.4-1.5-.4-2.7s.1-2 .4-2.7L1.6 6.4C.6 8.3 0 10.1 0 12s.6 3.7 1.6 5.6l3.7-2.9z"
              />
              <path
                fill="#34A853"
                d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.2-6.7-5.3L1.6 15.9C3.5 19.7 7.4 23 12 23z"
              />
            </svg>
            <span>{oauthLoading === "google" ? "Connecting to Google..." : "Continue with Google"}</span>
          </Button>

          <Button
            variant="outline"
            size="lg"
            className="w-full flex items-center justify-center gap-2.5 border-slate-300 hover:bg-slate-50 text-slate-700"
            onClick={() => handleOAuthSignIn("github")}
            disabled={oauthLoading !== null}
            data-testid="login-oauth-github-btn"
          >
            <svg className="size-4 fill-current text-slate-800" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            <span>{oauthLoading === "github" ? "Connecting to GitHub..." : "Continue with GitHub"}</span>
          </Button>

          <Button
            variant="outline"
            size="lg"
            className="w-full flex items-center justify-center gap-2 border-slate-300 hover:bg-slate-50 text-slate-700"
            onClick={() => handleOAuthSignIn("azure")}
            disabled={oauthLoading !== null}
            data-testid="login-sso-btn"
          >
            <Lock className="size-4 text-sky-700" />
            <span>{oauthLoading === "azure" ? "Connecting to SSO..." : "Continue with Official SSO"}</span>
          </Button>
        </div>

        <p className="mt-6 text-center text-sm text-slate-600">
          Don't have an account?{" "}
          <Link to="/register" className="font-semibold text-[#0F4C81] hover:underline" data-testid="login-register-link">
            Register Now
          </Link>
        </p>
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-center border border-slate-200/70" data-testid="login-demo-hint">
          <p className="font-mono text-[11px] text-slate-500 mb-2">Pre-configured test account available</p>
          <button
            type="button"
            onClick={() => handleFillDemo("test@gmail.com", "12345678")}
            className="w-full text-center text-xs font-sans font-bold text-[#0F4C81] hover:underline cursor-pointer border border-[#0F4C81]/25 py-1.5 px-2 rounded-md bg-white hover:bg-sky-50 transition-colors shadow-2xs"
          >
            Fill Demo Credentials
          </button>
        </div>
      </Card>
    </AuthFrame>
  );
}

const DESIGNATIONS = ["Government Official", "Disaster Management Officer", "Forest Officer", "Environmental Officer", "Administrator"];
const STATES = ["Uttarakhand", "Kerala", "Assam", "Karnataka", "Tamil Nadu", "Delhi", "Himachal Pradesh", "Maharashtra"];

export function RegisterPage() {
  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "", phone: "", organization: "",
    designation: "", state: "", district: "", password: "", confirm: "",
  });
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<RegisterResponse | null>(null);

  const set = (k: keyof typeof form) => (v: string) => setForm((p) => ({ ...p, [k]: v }));

  const register = useMutation({
    mutationFn: () => {
      const { confirm: _confirm, ...payload } = form;
      return apiPost<RegisterResponse>("/auth/register", payload);
    },
    onSuccess: (res) => setDone(res),
    onError: (err: any) => {
      const detail = err?.body?.detail ?? err?.message ?? "Registration could not be completed.";
      setErrors({ form: typeof detail === "string" ? detail : "Registration could not be completed." });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!form.first_name.trim()) next.first_name = "First name is required.";
    if (!form.last_name.trim()) next.last_name = "Last name is required.";
    if (!form.email.includes("@")) next.email = "Enter a valid official email address.";
    if (form.phone.trim().length < 6) next.phone = "Enter a valid mobile number.";
    if (form.organization.trim().length < 2) next.organization = "Organization / department is required.";
    if (!form.designation) next.designation = "Select your role.";
    if (!form.state) next.state = "Select your state.";
    if (!form.district.trim()) next.district = "District is required.";
    if (form.password.length < 8) next.password = "Password must be at least 8 characters.";
    if (form.password !== form.confirm) next.confirm = "Passwords do not match.";
    if (!agree) next.agree = "You must accept the terms and privacy policy.";
    setErrors(next);
    if (Object.keys(next).length === 0) register.mutate();
  };

  if (done) {
    return (
      <AuthFrame visual={<AuthVisual heading="Credentialing under review" sub="Government monitoring systems are unlocked only after administrator verification." />}>
        <Card className="border-slate-200/80 p-8 text-center" data-testid="register-success-card">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="size-7" />
          </span>
          <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900">Account Registration Successful</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Your account may require administrator verification before accessing restricted government monitoring
            systems.
          </p>
          <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-left text-xs text-slate-600">
            <span className="font-semibold text-slate-800">{done.user.email}</span> registered as{" "}
            <span className="font-semibold text-slate-800">{done.user.designation}</span> · status{" "}
            <span className="font-mono uppercase">{done.user.status}</span>
          </p>
          <Link to="/login" className={buttonVariants({ size: "lg", className: "mt-6 w-full" })} data-testid="register-go-to-login-btn">
            Go to Login
          </Link>
        </Card>
      </AuthFrame>
    );
  }

  const field = (name: keyof typeof form, label: string, type = "text", placeholder = "") => (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} type={type} value={form[name]} onChange={(e) => set(name)(e.target.value)} placeholder={placeholder} className="mt-1.5" data-testid={`register-${name}-input`} />
      {errors[name] ? <p className="mt-1 text-xs text-red-700" data-testid={`register-${name}-error`}>{errors[name]}</p> : null}
    </div>
  );

  return (
    <AuthFrame visual={<AuthVisual heading="National disaster management credentialing" sub="Register your department identity to request access to live environmental monitoring and hazard intelligence." />}>
      <Card className="border-slate-200/80 p-8" data-testid="register-card">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create Official Account</h1>
        <p className="mt-1.5 text-sm text-slate-600">Registration is reviewed before restricted systems are unlocked.</p>

        {errors.form ? (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" data-testid="register-error-alert">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{errors.form}</span>
          </div>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={submit} noValidate data-testid="register-form">
          <div className="grid gap-4 sm:grid-cols-2">
            {field("first_name", "First Name")}
            {field("last_name", "Last Name")}
          </div>
          {field("email", "Official Email Address", "email", "officer@dept.gov.in")}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("phone", "Mobile Number", "tel", "+91 98000 00000")}
            {field("organization", "Organization / Department")}
          </div>

          <div>
            <Label>Role</Label>
            <Select value={form.designation} onValueChange={(v: string) => set("designation")(v)}>
              <SelectTrigger className="mt-1.5 w-full" data-testid="register-designation-trigger">
                <SelectValue placeholder="Select your role" />
              </SelectTrigger>
              <SelectContent>
                {DESIGNATIONS.map((d) => (
                  <SelectItem key={d} value={d} data-testid={`register-designation-${d.toLowerCase().replace(/\s+/g, "-")}`}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.designation ? <p className="mt-1 text-xs text-red-700" data-testid="register-designation-error">{errors.designation}</p> : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>State</Label>
              <Select value={form.state} onValueChange={(v: string) => set("state")(v)}>
                <SelectTrigger className="mt-1.5 w-full" data-testid="register-state-trigger">
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  {STATES.map((s) => (
                    <SelectItem key={s} value={s} data-testid={`register-state-${s.toLowerCase().replace(/\s+/g, "-")}`}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.state ? <p className="mt-1 text-xs text-red-700" data-testid="register-state-error">{errors.state}</p> : null}
            </div>
            {field("district", "District")}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {field("password", "Password", "password")}
            <div>
              <Label htmlFor="confirm">Confirm Password</Label>
              <Input id="confirm" type="password" value={form.confirm} onChange={(e) => set("confirm")(e.target.value)} className="mt-1.5" data-testid="register-confirm-input" />
              {errors.confirm ? <p className="mt-1 text-xs text-red-700" data-testid="register-confirm-error">{errors.confirm}</p> : null}
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-600">
            <Checkbox checked={agree} onCheckedChange={(v) => setAgree(Boolean(v))} className="mt-0.5" data-testid="register-terms-checkbox" />
            <span>I accept the platform Terms of Use and Privacy Policy, and confirm the details provided are official.</span>
          </label>
          {errors.agree ? <p className="text-xs text-red-700" data-testid="register-terms-error">{errors.agree}</p> : null}

          <Button type="submit" size="lg" className="w-full" disabled={register.isPending} data-testid="register-submit-btn">
            {register.isPending ? "Submitting…" : "CREATE ACCOUNT"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Already registered?{" "}
          <Link to="/login" className="font-semibold text-[#0F4C81] hover:underline" data-testid="register-login-link">Sign in</Link>
        </p>
      </Card>
    </AuthFrame>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");

  const forgot = useMutation({
    mutationFn: () => apiPost<{ message: string }>("/auth/forgot-password", { email }),
    onSuccess: (res) => setSent(res.message),
    onError: (err) => setError(apiErrorMessage(err)),
  });

  return (
    <AuthFrame visual={<AuthVisual heading="Password recovery" sub="Reset instructions are dispatched only to verified official mailboxes on record." />}>
      <Card className="border-slate-200/80 p-8" data-testid="forgot-password-card">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Reset Password</h1>
        <p className="mt-1.5 text-sm text-slate-600">Enter the official email address linked to your account.</p>

        {sent ? (
          <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" data-testid="forgot-success-alert">
            {sent}
          </div>
        ) : (
          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("Enter a valid official email address."); return; }
              setError("");
              forgot.mutate();
            }}
            noValidate
            data-testid="forgot-password-form"
          >
            <div>
              <Label htmlFor="fp-email">Email Address</Label>
              <Input id="fp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" data-testid="forgot-email-input" />
              {error ? <p className="mt-1 text-xs text-red-700" data-testid="forgot-email-error">{error}</p> : null}
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={forgot.isPending} data-testid="forgot-submit-btn">
              {forgot.isPending ? "Sending…" : "SEND RESET INSTRUCTIONS"}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-600">
          <Link to="/login" className="font-semibold text-[#0F4C81] hover:underline" data-testid="forgot-back-to-login">Back to Login</Link>
        </p>
      </Card>
    </AuthFrame>
  );
}
