import { SignIn } from "@clerk/react";
import { motion } from "framer-motion";
import { KfiLogo } from "@/components/kfi-logo";
import { TrendingDown, BedDouble, FileCheck2, Building2 } from "lucide-react";

const STATS = [
  { icon: Building2, label: "Properties tracked", value: "30+ in 13 states" },
  { icon: BedDouble, label: "Beds monitored", value: "200+ live" },
  { icon: TrendingDown, label: "Loss caught", value: "Vacancy + undercharge" },
  { icon: FileCheck2, label: "Leases + bills", value: "From email & SharePoint" },
];

const ease = [0.22, 1, 0.36, 1] as const;

export default function SignInPage() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
      {/* Hero — the moment */}
      <div className="relative hidden overflow-hidden bg-[#0b1f3a] text-white lg:flex lg:flex-col lg:justify-between p-12">
        {/* ambient glows + grid */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-[radial-gradient(closest-side,rgba(59,130,246,0.35),transparent_70%)] blur-2xl" />
          <div className="absolute right-[-10%] top-1/3 h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(closest-side,rgba(37,99,235,0.25),transparent_70%)] blur-3xl" />
          <div className="absolute bottom-[-15%] left-1/4 h-80 w-80 rounded-full bg-[radial-gradient(closest-side,rgba(125,211,252,0.18),transparent_70%)] blur-2xl" />
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.6) 1px,transparent 1px)",
              backgroundSize: "44px 44px",
            }}
          />
        </div>

        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }} className="relative">
          <KfiLogo variant="full" className="text-white" />
        </motion.div>

        <div className="relative max-w-xl">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease }}
            className="text-4xl font-semibold leading-[1.1] tracking-tight xl:text-5xl"
          >
            Housing Command Center
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease }}
            className="mt-4 text-lg text-blue-100/80"
          >
            Every property, bed, lease, and dollar in one place — so you see exactly
            where you're winning and where you're bleeding money.
          </motion.p>

          <div className="mt-10 grid grid-cols-2 gap-4">
            {STATS.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 + i * 0.08, ease }}
                className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm"
              >
                <s.icon className="h-5 w-5 text-blue-300" />
                <div className="mt-2 text-sm font-semibold">{s.value}</div>
                <div className="text-xs text-blue-100/60">{s.label}</div>
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.7 }}
          className="relative text-xs uppercase tracking-[0.2em] text-blue-100/40"
        >
          KFI Workforce Deployment · Housing Operations
        </motion.div>
      </div>

      {/* Sign-in */}
      <div className="flex items-center justify-center bg-[#f6f1e7] p-6">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center justify-center text-[#0b1f3a] lg:hidden">
            <KfiLogo variant="full" />
          </div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease }}
            className="flex justify-center"
          >
            <SignIn
              routing="path"
              path={`${basePath}/sign-in`}
              signUpUrl={`${basePath}/sign-up`}
              fallbackRedirectUrl={`${basePath}/dashboard`}
              appearance={{
                variables: {
                  colorPrimary: "#1e3a8a",
                  borderRadius: "0.6rem",
                },
                elements: {
                  card: "shadow-xl border border-black/5",
                  headerTitle: "text-[#0b1f3a]",
                },
              }}
            />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
