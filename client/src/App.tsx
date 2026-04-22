import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, setAppToken } from "@/lib/queryClient";
import HomePage from "@/pages/home";
import NotFound from "@/pages/not-found";
import { useState } from "react";

function AppRouter() {
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const authQuery = useQuery<{ authenticated: boolean }>({
    queryKey: ["/api/auth/status"],
  });

  const loginMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/login", { password });
      return (await response.json()) as { token: string };
    },
    onSuccess: ({ token }) => {
      setAppToken(token, rememberMe);
      setError("");
      setPassword("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Incorrect password");
    },
  });

  if (authQuery.isLoading) {
    return <main className="min-h-screen bg-background" data-testid="state-auth-loading" />;
  }

  if (!authQuery.data?.authenticated) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-4">
        <Card className="w-full max-w-md border-card-border shadow-sm">
          <CardHeader>
            <CardTitle>NYC apartment search</CardTitle>
            <CardDescription>Enter the shared password to view and edit apartment listings.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                loginMutation.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="app-password">Password</Label>
                <Input
                  id="app-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  data-testid="input-app-password"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  className="size-4 rounded border-border"
                  data-testid="checkbox-remember-me"
                />
                Remember me on this browser
              </label>
              {error ? (
                <p className="text-sm text-destructive" data-testid="text-auth-error">
                  {error}
                </p>
              ) : null}
              <Button type="submit" className="w-full" disabled={loginMutation.isPending || !password} data-testid="button-login">
                {loginMutation.isPending ? "Checking..." : "Unlock"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
