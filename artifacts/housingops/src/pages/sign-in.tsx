import { SignIn } from "@clerk/react";

export default function SignInPage() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f6f1e7] p-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        afterSignInUrl={`${basePath}/dashboard`}
        afterSignUpUrl={`${basePath}/dashboard`}
      />
    </div>
  );
}
