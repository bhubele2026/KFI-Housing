import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";
import kfiLogoUrl from "@assets/kfi-staffing-logo.png";

export default function Login() {
  const [email, setEmail] = useState("");
  const [, setLocation] = useLocation();
  const { login } = useAuth();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login();
    setLocation("/dashboard");
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
            <div className="flex justify-center mb-2">
              <div className="rounded-xl bg-primary px-6 py-4 shadow-sm">
                <img
                  src={kfiLogoUrl}
                  alt="KFI Staffing"
                  className="h-12 w-auto object-contain"
                />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">Welcome back</CardTitle>
            <CardDescription className="text-zinc-500 dark:text-zinc-400">
              Sign in to KFI Staffing — Drastically Different Staffing.
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
