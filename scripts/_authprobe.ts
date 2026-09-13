import { createSessionToken, verifyToken } from "../src/lib/auth";
import { verifySessionToken } from "../src/lib/auth-edge";
const token = createSessionToken();
console.log("token:", token.slice(0, 60) + "...");
console.log("node-side verifyToken:", !!verifyToken(token, "session"));
console.log("edge-side verifySessionToken:", await verifySessionToken(token, process.env.AUTH_SECRET!));
console.log("payload:", Buffer.from(token.split(".")[0].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString());
