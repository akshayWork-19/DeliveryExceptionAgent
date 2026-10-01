import "dotenv/config";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Command } from "@langchain/langgraph";
import { app } from "./graph.js";
import type { DeliveryExceptionStateType } from "./state.js";

const PUBLIC_DIR = path.resolve(process.cwd(), "public");

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", (err) => reject(err));
  });
}

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  // Health check endpoint
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { status: "ok", message: "DeliveryExceptionAgent backend running" });
    return;
  }

  // Run graph endpoint
  if (req.method === "POST" && url.pathname === "/api/process") {
    try {
      const body = await parseJsonBody(req);
      const {
        reportText,
        courierId = "courier-1",
        orderId = `order-${Date.now().toString().slice(-4)}`,
        orderValue = 1500,
        threadId = `thread_${Date.now()}`,
      } = body;

      if (!reportText) {
        sendJson(res, 400, { error: "reportText is required" });
        return;
      }

      const config = {
        configurable: {
          thread_id: threadId,
        },
      };

      const initialState = {
        reportText: String(reportText),
        courierId: String(courierId),
        orderId: String(orderId),
        orderValue: Number(orderValue),
      };

      console.log(`\n[API] Invoking graph for thread: ${threadId}`);
      await app.invoke(initialState, config);

      const snap = await app.getState(config);
      console.log("[API] Snapshot next nodes:", snap.next);
      const stateValues = snap.values as DeliveryExceptionStateType;

      // Check if paused at interrupt (human approval needed)
      if (snap.next && snap.next.length > 0) {
        const interruptTask = snap.tasks && snap.tasks.length > 0 ? snap.tasks[0] : null;
        const interruptValue = interruptTask?.interrupts?.[0]?.value || {
          orderId: stateValues.orderId,
          orderValue: stateValues.orderValue,
          exceptionType: stateValues.classification?.exceptionType,
          summary: stateValues.classification?.summary,
          action: `Approve refund of order value (₹${stateValues.orderValue})`,
        };

        sendJson(res, 200, {
          status: "interrupted",
          nodePausedAt: snap.next[0],
          threadId,
          interrupt: interruptValue,
          state: stateValues,
        });
        return;
      }

      // Graph ran to completion
      sendJson(res, 200, {
        status: "completed",
        threadId,
        state: stateValues,
      });
    } catch (err: any) {
      console.error("[API Error] /api/process:", err);
      sendJson(res, 500, { error: err.message || "Failed to process delivery exception" });
    }
    return;
  }

  // Resume interrupted graph endpoint (human decision)
  if (req.method === "POST" && url.pathname === "/api/resume") {
    try {
      const body = await parseJsonBody(req);
      const { threadId, approved } = body;

      if (!threadId) {
        sendJson(res, 400, { error: "threadId is required" });
        return;
      }

      const config = {
        configurable: {
          thread_id: threadId,
        },
      };

      console.log(`\n[API] Resuming thread ${threadId} with approved = ${approved}`);
      await app.invoke(
        new Command({
          resume: {
            approved: Boolean(approved),
          },
        }),
        config
      );

      const snap = await app.getState(config);
      const stateValues = snap.values as DeliveryExceptionStateType;
      console.log("[API] Resumed snapshot state:", stateValues);

      sendJson(res, 200, {
        status: "completed",
        threadId,
        state: stateValues,
      });
    } catch (err: any) {
      console.error("[API Error] /api/resume:", err);
      sendJson(res, 500, { error: err.message || "Failed to resume exception workflow" });
    }
    return;
  }

  // Static file serving from public/
  let reqPath = url.pathname === "/" ? "/index.html" : url.pathname;
  let filePath = path.join(PUBLIC_DIR, reqPath);

  // Security check to prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
      } else {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      }
      return;
    }

    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`
======================================================
 Delivery Exception Agent Server running!
 URL: http://localhost:${PORT}
 API Endpoints:
  - GET  /api/health
  - POST /api/process
  - POST /api/resume
======================================================
  `);
});
