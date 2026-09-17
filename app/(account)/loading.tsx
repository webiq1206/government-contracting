import { PageLoading } from "@/components/page-loading";

// Keep streamed loading UI inside the authenticated app. A root loading
// boundary leaves the async public homepage hidden when JavaScript is absent.
export default function Loading() {
  return <PageLoading />;
}
