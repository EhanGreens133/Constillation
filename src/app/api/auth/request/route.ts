import { fail, json, readJson } from "@/lib/api";
import { requestMagicLink } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJson<{ email?: string }>(req).catch(() => ({ email: undefined }));
    const result = await requestMagicLink(body.email);
    return json({ ok: true, ...result });
  } catch (err) {
    return fail(err);
  }
}
