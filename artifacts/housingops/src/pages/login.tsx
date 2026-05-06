import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth, readLastRoute } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";
import logoUrl from "@/assets/kfi-staffing-logo.png";

export default function Login() {
  const [email, setEmail] = useState("");
  const [, setLocation] = useLocation();
  const { login } = useAuth();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login();
    // Drop the operator back on the page they were last viewing before
    // the tab closed; falls back to /dashboard for first-time logins or
    // when localStorage is unreadable.
    setLocation(readLastRoute() ?? "/dashboard");
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="w-full max-w-md shadow-xl border-zinc-200 dark:border-zinc-800">
          <CardHeader className="space-y-3 text-center pb-6">
            <div className="flex flex-col items-center gap-2 mb-2">
              <img
                src={logoUrl}
                alt="KFI Staffing"
                className="h-24 w-full max-w-[320px] rounded-md object-contain"
                data-testid="img-login-logo"
              />
              <div
                className="text-[11px] font-semibold uppercase tracking-[0.25em] text-zinc-500 dark:text-zinc-400"
                data-testid="text-login-product-name"
              >
                HousingOps
              </div>
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">Welcome back</CardTitle>
            <CardDescription className="text-zinc-500 dark:text-zinc-400">
              Sign in to HousingOps to manage your properties, leases, beds, and occupants.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-white dark:bg-zinc-900"
                />
              </div>
              <Button type="submit" className="w-full mt-6" size="lg">
                Sign in
              </Button>
            </form>
          </CardContent>
          <CardFooter className="justify-center border-t py-4 text-sm text-zinc-500 dark:text-zinc-400">
            Any email will work for the demo — no password required.
          </CardFooter>
        </Card>
      </motion.div>
    </div>
  );
}
