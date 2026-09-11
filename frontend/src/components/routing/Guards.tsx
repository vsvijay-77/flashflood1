import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { useSession } from "@/lib/session";
import type { Role } from "@/lib/types";

function Booting() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#F7F9FC]" data-testid="session-booting">
      <div className="flex items-center gap-3 text-sm text-slate-600">
        <span className="size-4 animate-spin rounded-full border-2 border-[#0F4C81] border-t-transparent" />
        Verifying secure session…
      </div>
    </div>
  );
}

export function AccessRestricted() {
  return (
    <div className="grid min-h-[70vh] place-items-center px-6" data-testid="access-restricted-page">
      <div className="max-w-md text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-red-50 text-red-700">
          <ShieldAlert className="size-8" />
        </span>
        <p className="mt-6 font-mono text-5xl font-bold text-slate-900">403</p>
        <h1 className="mt-2 text-xl font-bold uppercase tracking-[0.12em] text-slate-900">Access Restricted</h1>
        <p className="mt-3 text-sm text-slate-600">
          You do not have permission to access this resource. Contact your department administrator if you
          believe this clearance level is incorrect.
        </p>
        <Link to="/dashboard" className={buttonVariants({ className: "mt-6" })} data-testid="forbidden-back-btn">
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isResolved } = useSession();
  const location = useLocation();
  if (!isResolved) return <Booting />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function RoleBasedRoute({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { user, isResolved } = useSession();
  if (!isResolved) return <Booting />;
  if (!user) return <Navigate to="/login" replace />;
  if (!allow.includes(user.role)) return <AccessRestricted />;
  return <>{children}</>;
}
