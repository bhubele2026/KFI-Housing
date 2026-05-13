import { SignUp } from "@clerk/react";

export default function SignUpPage() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const invitedEmail =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("email") ?? undefined
      : undefined;
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f6f1e7] p-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        fallbackRedirectUrl={`${basePath}/dashboard`}
        initialValues={invitedEmail ? { emailAddress: invitedEmail } : undefined}
      />
    </div>
  );
}
