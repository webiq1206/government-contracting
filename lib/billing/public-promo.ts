import { getFoundingPromo, type PromoWindow } from "./promo";
const FALLBACK: PromoWindow = {
  active: false,
  startedAt: null,
  endsAt: null,
  durationDays: 5,
  remainingMs: 0,
};
/** Marketing stays available if the optional promotion lookup is unavailable. */
export async function loadPublicPromo(
  startIfMissing = false,
): Promise<PromoWindow> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getFoundingPromo({ startIfMissing }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Public promotion lookup timed out")),
          1500,
        );
      }),
    ]);
  } catch (error) {
    console.warn(
      "[marketing] promotion unavailable; showing standard pricing",
      error instanceof Error ? error.message : String(error),
    );
    return FALLBACK;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
