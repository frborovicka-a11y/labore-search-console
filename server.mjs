import http from "node:http";

const PORT = Number(process.env.PORT || 8080);
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};
const rpc = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

export const tools = [
  {
    name: "list_sites",
    description: "Vypíše weby dostupné v Google Search Console.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "search_analytics",
    description: "Načte výkon ve Vyhledávání Google: kliknutí, zobrazení, CTR a pozice.",
    inputSchema: {
      type: "object",
      required: ["siteUrl", "startDate", "endDate"],
      properties: {
        siteUrl: { type: "string", description: "Např. sc-domain:labore.cz nebo https://www.labore.cz/" },
        startDate: { type: "string", description: "YYYY-MM-DD" },
        endDate: { type: "string", description: "YYYY-MM-DD" },
        dimensions: { type: "array", items: { enum: ["date", "query", "page", "country", "device", "searchAppearance"] } },
        rowLimit: { type: "integer", minimum: 1, maximum: 25000, default: 1000 },
        startRow: { type: "integer", minimum: 0, default: 0 },
        type: { type: "string", enum: ["web", "image", "video", "news", "discover", "googleNews"], default: "web" }
      },
      additionalProperties: false
    }
  },
  {
    name: "inspect_url",
    description: "Zkontroluje stav indexace konkrétní URL.",
    inputSchema: {
      type: "object",
      required: ["siteUrl", "inspectionUrl"],
      properties: { siteUrl: { type: "string" }, inspectionUrl: { type: "string" }, languageCode: { type: "string", default: "cs-CZ" } },
      additionalProperties: false
    }
  },
  {
    name: "list_sitemaps",
    description: "Vypíše soubory sitemap webu.",
    inputSchema: { type: "object", required: ["siteUrl"], properties: { siteUrl: { type: "string" } }, additionalProperties: false }
  },
  {
    name: "submit_sitemap",
    description: "Odešle sitemap do Search Console. Použij jen po výslovném potvrzení uživatele.",
    inputSchema: { type: "object", required: ["siteUrl", "feedpath"], properties: { siteUrl: { type: "string" }, feedpath: { type: "string" } }, additionalProperties: false }
  },
  {
    name: "delete_sitemap",
    description: "Odstraní sitemap ze Search Console. Použij jen po výslovném potvrzení uživatele.",
    inputSchema: { type: "object", required: ["siteUrl", "feedpath"], properties: { siteUrl: { type: "string" }, feedpath: { type: "string" } }, additionalProperties: false }
  }
];

async function google(token, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(options.headers || {}) }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Google API ${response.status}: ${text.slice(0, 2000)}`);
  return text ? JSON.parse(text) : { success: true };
}

export async function callTool(name, args, token) {
  if (name === "list_sites") return google(token, "https://www.googleapis.com/webmasters/v3/sites");
  if (name === "search_analytics") {
    const { siteUrl, ...body } = args;
    return google(token, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, { method: "POST", body: JSON.stringify(body) });
  }
  if (name === "inspect_url") {
    return google(token, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
      method: "POST",
      body: JSON.stringify({ inspectionUrl: args.inspectionUrl, siteUrl: args.siteUrl, languageCode: args.languageCode || "cs-CZ" })
    });
  }
  if (name === "list_sitemaps") return google(token, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(args.siteUrl)}/sitemaps`);
  if (name === "submit_sitemap" || name === "delete_sitemap") {
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(args.siteUrl)}/sitemaps/${encodeURIComponent(args.feedpath)}`;
    return google(token, url, { method: name === "submit_sitemap" ? "PUT" : "DELETE" });
  }
  throw new Error(`Neznámý nástroj: ${name}`);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true });
  if (req.method !== "POST" || req.url !== "/mcp") return json(res, 404, { error: "Not found" });
  let raw = "";
  req.on("data", chunk => raw += chunk);
  req.on("end", async () => {
    let message;
    try { message = JSON.parse(raw); } catch { return json(res, 400, rpcError(null, -32700, "Parse error")); }
    const { id = null, method, params = {} } = message;
    if (method === "initialize") return json(res, 200, rpc(id, { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "labore-search-console", version: "1.0.0" } }));
    if (method === "notifications/initialized") { res.writeHead(202); return res.end(); }
    if (method === "tools/list") return json(res, 200, rpc(id, { tools }));
    if (method === "ping") return json(res, 200, rpc(id, {}));
    if (method !== "tools/call") return json(res, 200, rpcError(id, -32601, "Method not found"));
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return json(res, 401, rpcError(id, -32001, "Chybí OAuth token"));
    try {
      const data = await callTool(params.name, params.arguments || {}, token);
      return json(res, 200, rpc(id, { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data }));
    } catch (error) {
      return json(res, 200, rpc(id, { isError: true, content: [{ type: "text", text: String(error.message || error) }] }));
    }
  });
});

if (!process.env.VERCEL) {
  server.listen(PORT, "0.0.0.0", () => console.log(`Listening on ${PORT}`));
}
