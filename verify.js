// Vercel Serverless Function - /api/verify
// Secure certificate verification using Framer CMS

const {
  FRAMER_SITE_ID,
  FRAMER_COLLECTION_ID = "certificates",
  FRAMER_API_KEY,
  ALLOWED_ORIGINS,
} = process.env;

// ---------------- helpers ----------------
function normalizeName(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFKC")
    .toLowerCase();
}
function normalizeSerial(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFKC")
    .toUpperCase();
}
function isValidSerialFormat(serial) {
  return /^[A-Z0-9\-\s]{3,64}$/.test(serial);
}

function corsHeaders(req) {
  const origin = req.headers.get("origin") || "";
  const allowed = (ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const ok = allowed.some((rule) => {
    if (rule === "*") return true;
    if (rule.startsWith("https://*.")) {
      const base = rule.replace("https://*.", "");
      return origin.startsWith("https://") && origin.endsWith("." + base);
    }
    return origin === rule;
  });

  return {
    "Access-Control-Allow-Origin": ok ? origin : "null",
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

// ---------------- main handler ----------------
export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(204).set(corsHeaders(req)).end();
  }

  try {
    if (!FRAMER_API_KEY || !FRAMER_SITE_ID) {
      return res.status(500).set(corsHeaders(req)).json({
        matched: false,
        error: "Backend missing env vars",
      });
    }

    if (req.method !== "GET") {
      return res.status(405).set(corsHeaders(req)).json({
        matched: false,
        error: "Method not allowed",
      });
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const nameRaw = url.searchParams.get("name") || "";
    const serialRaw = url.searchParams.get("serial") || "";

    if (!nameRaw || !serialRaw) {
      return res.status(400).set(corsHeaders(req)).json({
        matched: false,
        error: "Missing name or serial",
      });
    }

    const wantName = normalizeName(nameRaw);
    const wantSerial = normalizeSerial(serialRaw);

    if (!isValidSerialFormat(wantSerial)) {
      return res.status(400).set(corsHeaders(req)).json({
        matched: false,
        error: "Invalid serial format",
      });
    }

    const endpoint = `https://api.framer.com/v1/sites/${encodeURIComponent(
      FRAMER_SITE_ID
    )}/collections/${encodeURIComponent(
      FRAMER_COLLECTION_ID
    )}/items?limit=1000`;

    const cmsRes = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${FRAMER_API_KEY}` },
      cache: "no-store",
    });

    if (!cmsRes.ok) {
      const txt = await cmsRes.text().catch(() => "");
      console.error("Framer API error:", cmsRes.status, txt);
      return res.status(502).set(corsHeaders(req)).json({
        matched: false,
        error: "Framer CMS fetch failed",
      });
    }

    const data = await cmsRes.json();
    const items = data.items || [];

    const found = items.find((it) => {
      const f = it.fields || it;
      const studentName = normalizeName(f.studentName || f.name || "");
      const serialNumber = normalizeSerial(f.serialNumber || f.serial || "");
      return studentName === wantName && serialNumber === wantSerial;
    });

    if (found) {
      const f = found.fields || found;
      return res
        .status(200)
        .set(corsHeaders(req))
        .json({
          matched: true,
          item: {
            studentName: f.studentName || "",
            courseTitle: f.courseTitle || "",
            issueDate: f.issueDate || "",
            certificateURL: f.certificateURL || "",
          },
        });
    }

    return res.status(200).set(corsHeaders(req)).json({ matched: false });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .set(corsHeaders(req))
      .json({
        matched: false,
        error: err.message || "Server error",
      });
  }
}
