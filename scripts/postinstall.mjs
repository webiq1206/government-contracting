// Best-effort postinstall. Never fails the install, optional deps (playwright,
// bullmq) may be absent on some hosts (e.g. Replit) and that is fine.
console.log("[postinstall] BROSTCO dependencies installed.");
console.log("[postinstall] Next steps:");
console.log("  1. cp .env.example .env  &&  fill in DATABASE_URL + ANTHROPIC_API_KEY");
console.log("  2. npm run db:setup       (runs migrations + seeds company profile)");
console.log("  3. npm run dev            (starts web + worker)");
