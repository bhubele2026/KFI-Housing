import { SignUp } from "@clerk/react";
import { KfiLogo } from "@/components/kfi-logo";

export default function SignUpPage() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#0b1f3a] p-6">
      <KfiLogo variant="full" className="text-white" />
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        fallbackRedirectUrl={`${basePath}/dashboard`}
        appearance={{
          variables: { colorPrimary: "#1e3a8a", borderRadius: "0.6rem" },
          elements: { card: "shadow-xl border border-black/5" },
        }}
      />
    </div>
  );
}
