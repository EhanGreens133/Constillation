import { fail, json, requireAuthor } from "@/lib/api";
import { buildBundle, buildExport, renderArchiveJson, type Edition } from "@/lib/export/build";
import { renderArchiveHtml } from "@/lib/export/html";
import { renderArchiveTxt } from "@/lib/export/txt";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/export?edition=inheritance|working&format=zip|html|json|txt
 *
 * The zip is the real answer: four files, self-contained, with a build
 * timestamp. The single-format options exist so the author can grab one file
 * quickly, not as a substitute for the whole bundle.
 */
export async function GET(req: Request) {
  try {
    await requireAuthor();
    const p = new URL(req.url).searchParams;
    const edition: Edition = p.get("edition") === "working" ? "working" : "inheritance";
    const format = (p.get("format") ?? "zip").toLowerCase();
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === "zip") {
      const result = await buildExport(edition);
      return new Response(new Uint8Array(result.zip), {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${result.filename}"`,
          "content-length": String(result.zip.length),
          "cache-control": "no-store",
        },
      });
    }

    const bundle = await buildBundle(edition);
    const name = `constellation-${edition}-${stamp}`;

    if (format === "html") {
      return new Response(renderArchiveHtml(bundle), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-disposition": `attachment; filename="${name}.html"`,
          "cache-control": "no-store",
        },
      });
    }
    if (format === "txt") {
      return new Response(renderArchiveTxt(bundle), {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": `attachment; filename="${name}.txt"`,
          "cache-control": "no-store",
        },
      });
    }
    if (format === "json") {
      return new Response(renderArchiveJson(bundle), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${name}.json"`,
          "cache-control": "no-store",
        },
      });
    }
    return json({ error: "format must be zip, html, txt or json" }, 400);
  } catch (err) {
    return fail(err);
  }
}
