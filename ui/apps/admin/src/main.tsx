import '@hale/tokens';
import '@hale/tokens/fonts.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The admin events (the hub, else the event stream) read again what
      // they name; each query that follows them takes its refetch interval
      // from whether they flow (api/live.ts), so nothing is read on a timer
      // while they do.
      staleTime: 5_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
