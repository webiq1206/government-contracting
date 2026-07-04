import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Nav } from "@/components/nav";
import LoginPage from "@/pages/login";
import PipelinePage from "@/pages/pipeline";
import ReviewPage from "@/pages/review";
import OpportunityDetailPage from "@/pages/opportunity-detail";
import SubsPage from "@/pages/subs";
import SubDetailPage from "@/pages/sub-detail";
import CallQueuePage from "@/pages/call-queue";
import AnalyticsPage from "@/pages/analytics";
import AgentsPage from "@/pages/agents";
import CompliancePage from "@/pages/compliance";
import ContractsPage from "@/pages/contracts";
import SettingsProfilePage from "@/pages/settings-profile";
import SettingsIntegrationsPage from "@/pages/settings-integrations";
import { useGetPipelineSummary, useGetCallCards } from "@workspace/api-client-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function DashboardLayout() {
  const { data: summary } = useGetPipelineSummary();
  const { data: callCards = [] } = useGetCallCards();
  const humanActionCount = (summary as Record<string, unknown> | undefined)?.human_action_count as number ?? 0;
  const callCount = Array.isArray(callCards) ? callCards.length : 0;

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-ink-950">
      <Nav reviewCount={humanActionCount} callCount={callCount} />
      <main className="flex-1 min-w-0 overflow-hidden">
        <Switch>
          <Route path="/" component={() => <Redirect to="/pipeline" />} />
          <Route path="/pipeline" component={PipelinePage} />
          <Route path="/review" component={ReviewPage} />
          <Route path="/opportunity/:id" component={OpportunityDetailPage} />
          <Route path="/subs" component={SubsPage} />
          <Route path="/subs/:id" component={SubDetailPage} />
          <Route path="/call-queue" component={CallQueuePage} />
          <Route path="/analytics" component={AnalyticsPage} />
          <Route path="/compliance" component={CompliancePage} />
          <Route path="/contracts" component={ContractsPage} />
          <Route path="/agents" component={AgentsPage} />
          <Route path="/settings/profile" component={SettingsProfilePage} />
          <Route path="/settings/integrations" component={SettingsIntegrationsPage} />
          <Route component={() => (
            <div className="flex h-screen flex-col items-center justify-center">
              <p className="text-2xl font-bold text-white">404</p>
              <p className="mt-1 text-sm text-slate-400">Page not found</p>
              <a href="/pipeline" className="btn-ghost mt-4">← Pipeline</a>
            </div>
          )} />
        </Switch>
      </main>
    </div>
  );
}

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950">
        <p className="text-sm text-slate-400">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route component={() => <Redirect to="/login" />} />
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/login" component={() => <Redirect to="/pipeline" />} />
      <Route component={DashboardLayout} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
