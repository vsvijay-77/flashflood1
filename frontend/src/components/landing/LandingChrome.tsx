import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, ShieldCheck, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Home", to: "/" },
  { label: "Platform", to: "/platform" },
  { label: "About", to: "/about" },
];

export function LandingNavbar() {
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full border-b transition-shadow duration-200",
        stuck ? "border-slate-200/90 bg-white/95 shadow-[0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-md" : "border-transparent bg-white",
      )}
      data-testid="landing-navbar"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6 lg:px-8">
        <Link to="/" className="flex shrink-0 items-center gap-3" data-testid="brand-logo-link">
          <span className="grid size-10 place-items-center rounded-lg bg-[#0B2545] text-white">
            <ShieldCheck className="size-5" />
          </span>
          <span className="leading-none">
            <span className="block text-[11px] font-bold uppercase tracking-[0.2em] text-[#0F4C81]">Environmental</span>
            <span className="block text-[13px] font-bold uppercase tracking-[0.14em] text-slate-900">Intelligence Network</span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-2 lg:flex" data-testid="landing-nav-links">
          {NAV.map((item, i) => (
            <Link
              key={`${item.label}-${i}`}
              to={item.to}
              className={cn(
                "rounded-md px-4 py-2 text-base font-semibold text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-[#0F4C81]",
                pathname === item.to && "text-[#0F4C81]",
              )}
              data-testid={`nav-link-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <Link to="/login" className={buttonVariants({ variant: "outline", size: "default", className: "hidden sm:inline-flex font-semibold" })} data-testid="navbar-login-btn">
            Login
          </Link>
          <Link to="/register" className={buttonVariants({ size: "default", className: "hidden sm:inline-flex font-semibold" })} data-testid="navbar-register-btn">
            Register
          </Link>
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setOpen((v) => !v)} data-testid="navbar-mobile-toggle" aria-label="Toggle navigation">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-slate-200 bg-white px-4 py-3 lg:hidden" data-testid="navbar-mobile-menu">
          {NAV.map((item, i) => (
            <Link
              key={`m-${item.label}-${i}`}
              to={item.to}
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {item.label}
            </Link>
          ))}
          <div className="mt-2 flex gap-2">
            <Link to="/login" className={buttonVariants({ variant: "outline", size: "sm", className: "flex-1" })}>Login</Link>
            <Link to="/register" className={buttonVariants({ size: "sm", className: "flex-1" })}>Register</Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}

export function GovernmentFooter() {
  return (
    <footer className="border-t border-[#1E3A5F] bg-[#0A192F] text-slate-300" data-testid="government-footer">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-4 lg:px-8">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-emerald-500/20 text-emerald-400">
              <ShieldCheck className="size-5" />
            </span>
            <span>
              <span className="block text-[14px] font-bold tracking-tight text-white">Environmental Intelligence Network</span>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-emerald-400">From Environmental Signals to Actionable Intelligence.</span>
            </span>
          </div>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-slate-400">
            An integrated monitoring and decision-support platform for disaster management authorities, forest departments, environmental agencies, and emergency response organizations.
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-white">Platform</p>
          <ul className="mt-4 space-y-3 text-sm">
            <li><Link to="/about" className="text-slate-400 hover:text-white transition-colors">About the Platform</Link></li>
            <li><Link to="/platform" className="text-slate-400 hover:text-white transition-colors">Platform Architecture</Link></li>
            <li><Link to="/login" className="text-slate-400 hover:text-white transition-colors">Live Monitoring</Link></li>
            <li><Link to="/login" className="text-slate-400 hover:text-white transition-colors">GIS Intelligence</Link></li>
            <li><Link to="/login" className="text-emerald-400 hover:text-emerald-300 transition-colors font-medium">Officer Sign In</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-white">Emergency</p>
          <ul className="mt-4 space-y-3 font-mono text-sm">
            <li className="text-amber-400"><span className="text-slate-400 font-sans mr-2">NDMA Helpline</span> 1078</li>
            <li className="text-amber-400"><span className="text-slate-400 font-sans mr-2">Emergency Response</span> 112</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-800 bg-[#061121] px-4 py-6 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500">
        <div className="flex items-center gap-2 text-red-400/80 font-mono tracking-widest font-bold">
          <span className="relative flex size-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex size-1.5 rounded-full bg-red-500"></span></span>
          RESTRICTED GOVERNMENT MONITORING PLATFORM
        </div>
        <p>© 2026 Environmental Intelligence Network. All authorized access is logged and audited.</p>
      </div>
    </footer>
  );
}
