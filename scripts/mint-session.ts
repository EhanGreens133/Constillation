/**
 * Prints a valid session cookie, for curl-ing the API without a browser.
 *
 *   npm run session
 *   curl -H "Cookie: $(npm run -s session)" http://localhost:3000/api/health
 */

import { SESSION_COOKIE, createSessionToken } from "../src/lib/auth";

process.stdout.write(`${SESSION_COOKIE}=${createSessionToken()}`);
