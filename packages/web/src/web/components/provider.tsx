import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VaultProvider } from "../hooks/use-vault";
import { ErrorGuard } from "./error-guard";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 業務データは金庫ストア側で持つため、API 側の再取得は控えめにする
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

interface ProviderProps {
  children: React.ReactNode;
}

// App-level providers — add theme/context providers here, wrapping children.
// QueryClientProvider must stay (all API calls run through TanStack Query).
export function Provider({ children }: ProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorGuard>
        <VaultProvider>{children}</VaultProvider>
      </ErrorGuard>
    </QueryClientProvider>
  );
}
