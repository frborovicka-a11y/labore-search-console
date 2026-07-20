import { tools, callTool } from "../server.mjs";

const rpc = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const message = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const { id = null, method, params = {} } = message || {};

  if (method === "initialize") {
    return res.status(200).json(rpc(id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "labore-search-console", version: "1.0.0" }
    }));
  }
  if (method === "notifications/initialized") return res.status(202).end();
  if (method === "tools/list") return res.status(200).json(rpc(id, { tools }));
  if (method === "ping") return res.status(200).json(rpc(id, {}));
  if (method !== "tools/call") return res.status(200).json(rpcError(id, -32601, "Method not found"));

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json(rpcError(id, -32001, "Chybí OAuth token"));

  try {
    const data = await callTool(params.name, params.arguments || {}, token);
    return res.status(200).json(rpc(id, {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data
    }));
  } catch (error) {
    return res.status(200).json(rpc(id, {
      isError: true,
      content: [{ type: "text", text: String(error.message || error) }]
    }));
  }
}
