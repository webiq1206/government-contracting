/** Share a durable request identity between the contact profile and inbox. No message bodies in storage. */
export function manualSendStorageKey(sub: string, thread: string | null, project: string | null) {
  return `manual-email:${thread ?? `pair:${project ?? "none"}:${sub}`}:${sub}`;
}
export function preserveSendRequest(storage: Pick<Storage, "getItem" | "setItem">, key: string, create = () => crypto.randomUUID()) {
  const request = storage.getItem(key) || create();
  storage.setItem(key, request);
  return request;
}
