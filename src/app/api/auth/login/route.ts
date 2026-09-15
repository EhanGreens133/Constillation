import { NextResponse } from "next/server";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { checkPassword, passwordConfigured } from "@/lib/password";

export const dynamic = "force-dynamic";

/**
 * Password sign-in for the single account.
 *
 * Failures are counted and slowed down: there is one password protecting
 * everything the author ever wrote, so an unlimited guessing rate would make
 * the length of that password the only thing standing between a stranger and
 * the whole archive.
 *
 * Two things this has to get right beyond counting:
 *
 *   - The slot is taken *before* the password is checked, not after. Checking
 *     first and counting afterwards leaves a window either side of the await
 *     in which any number of concurrent requests pass a gate that is still
 *     reading zero - turning "ten guesses per ten minutes" into ten per round
 *     trip, times however many requests fit in one.
 *
 *   - Counting is per client. A single global counter means any stranger can
 *     lock the author out of his own archive with ten wrong guesses. The
 *     global counter is kept as well, but only as a CPU guard and with a much
 *     higher ceiling.
 *
 * Neither limit can lock the author out permanently: `npm run login` mints a
 * sign-in link from the machine itself and does not go through here.
 */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_CLIENT = 10;
/** Only to stop one host burning CPU on scrypt for everybody. */
const MAX_TOTAL = 60;

const byClient = new Map<string, number[]>();
let everyone: number[] = [];

function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "local";
}

function recent(times: number[], now: number): number[] {
  return times.filter((t) => now - t < WINDOW_MS);
}

/** Records an attempt and reports how long to wait, 0 when allowed. */
function takeSlot(key: string): number {
  const now = Date.now();
  const mine = recent(byClient.get(key) ?? [], now);
  everyone = recent(everyone, now);

  if (mine.length >= MAX_PER_CLIENT) {
    byClient.set(key, mine);
    return Math.ceil((WINDOW_MS - (now - mine[0])) / 1000);
  }
  if (everyone.length >= MAX_TOTAL) {
    return Math.ceil((WINDOW_MS - (now - everyone[0])) / 1000);
  }

  mine.push(now);
  everyone.push(now);
  byClient.set(key, mine);

  // The map would otherwise grow with every distinct source address.
  if (byClient.size > 500) {
    for (const [k, times] of byClient) {
      if (recent(times, now).length === 0) byClient.delete(k);
    }
  }
  return 0;
}

function clearSlots(key: string): void {
  byClient.delete(key);
  everyone = [];
}

export async function POST(req: Request) {
  if (!passwordConfigured()) {
    return NextResponse.json(
      {
        // The wording stays neutral because this same server may be a laptop
        // or a deployed host, and the fix is different for each. The page
        // decides which instruction to show.
        error: "No password is set on this server yet.",
        code: "no_password",
      },
      { status: 409 },
    );
  }

  // Read the body before taking a slot, so the only await between taking the
  // slot and using it is the password check itself.
  let password = "";
  try {
    password = String(((await req.json()) as { password?: string }).password ?? "");
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const key = clientKey(req);
  const wait = takeSlot(key);
  if (wait > 0) {
    return NextResponse.json(
      {
        error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s), or run \`npm run login\` on the server.`,
      },
      { status: 429, headers: { "retry-after": String(wait) } },
    );
  }

  if (!(await checkPassword(password))) {
    const left = MAX_PER_CLIENT - (byClient.get(key)?.length ?? 0);
    return NextResponse.json(
      { error: left > 0 && left <= 3 ? `Wrong password. ${left} attempt(s) left.` : "Wrong password." },
      { status: 401 },
    );
  }

  clearSlots(key);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions);
  return res;
}
