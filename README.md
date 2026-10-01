# delivery-exception-agent

A delivery exception routing engine built with **LangGraph.js** and **Groq** (`openai/gpt-oss-20b`), complete with an interactive **HTML/CSS/JS frontend**, live human-in-the-loop (HITL) approval, and real-time state machine visualization.

It parses courier failure reports, classifies the issue using structured outputs, and routes actions based on both the **exception category** and the **monetary value** of the order. It supports retry policies for automated actions and human-in-the-loop approval interrupts for high-value refunds.

---

## Architecture & Routing Workflow

```
                       [ START ]
                           |
                           v
                 [ classifyException ]
                  (Groq Structured)
                   /       |       \
     package_damaged       |        customer_unavailable / other
           |               |                     |
           |   (customer_refused OR              |
           |    address_unreachable)             |
           |               |                     |
           |      [ orderValue > 2000? ]         |
           |             /       \               |
           |          YES         NO             |
           |           v           \             |
           |  [ refundApproval ]    \            |
           |    (interrupt())        \           |
           |       /       \          v          v
           |   Approved  Rejected  [ retryDelivery ]
           |      |        |       (retryPolicy: max 3)
           |      v        |                     |
           | [processRefund]                     |
           |      |        |                     |
           v      v        v                     |
      [ flagForInvestigation ]                   |
           \      |                              |
            v     v                              v
           [ finalizeResolution ] <--------------+
                  |
                  v
               [ END ]
```

### 1. State Definition (`src/state.ts`)
- `reportText`: Raw description of delivery failure submitted by the courier.
- `courierId`: Identifier for the courier partner.
- `orderId`: Unique order tracking identifier.
- `orderValue`: Numeric order total (used for routing decisions).
- `classification`: Structured object containing `exceptionType` and `summary`.
- `resolution`: Final action taken (redelivery scheduled, refund issued, or investigation ticket opened).

### 2. Graph Nodes & Routing Logic (`src/nodes.ts`)
- **`classifyException`**:
  Uses Groq with `ExceptionClassificationSchema` to extract:
  - `package_damaged` -> Immediately routes to `flagForInvestigation`.
  - `customer_refused` / `address_unreachable` -> If `orderValue > 2000`, routes to `exceptionRefundApproval` (human review required). Otherwise, routes to `retryParcelDelivery`.
  - `customer_unavailable` / `other` -> Routes directly to `retryParcelDelivery`.
- **`retryDelivery`**:
  Simulates redelivery dispatch. Configured in `src/graph.ts` with a `retryPolicy: { maxAttempts: 3 }` to handle transient network/dispatch API failures.
- **`refundApproval`**:
  Calls `interrupt()` with order details to pause graph execution. When resumed:
  - If `approved: true` -> Routes to `processRefund`.
  - If `approved: false` -> Routes to `flagForInvestigation`.
- **`processRefund`**:
  Records refund confirmation for `orderValue` and routes to `finalizeResolution`.
- **`flagForInvestigation`**:
  Generates an investigation ticket (`INV-00042`) and routes to `finalizeResolution`.
- **`finalizeResolution`**:
  Convergence point logging the final resolution before reaching `END`.

### 3. Execution & Checkpointing (`src/index.ts`, `src/graph.ts`)
- State persistence and execution pausing are powered by `MemorySaver`.
- `src/index.ts` runs an order with value ₹4999 (above the ₹2000 threshold), pauses at `interrupt()`, inspects `snap.next`, and resumes execution with a simulated human decision via `new Command({ resume: { approved: false } })`.

---

## Web Frontend & Interactive Dashboard

The repository includes a modern, zero-framework **HTML, CSS, and Vanilla JavaScript** frontend hosted under `public/`:

- **Interactive Dispatch Form**: Submit custom delivery reports with dynamic Order ID, Courier ID, and Order Value.
- **1-Click Test Scenarios**: Quick-load preset scenarios to test every routing branch without manual typing:
  - 🚨 **Refused (High Value: ₹4,999)**: Pauses execution at `exceptionRefundApproval` for human review.
  - 🔄 **Refused (Low Value: ₹850)**: Under threshold; auto-routes to `retryParcelDelivery`.
  - 📦 **Damaged Parcel (₹3,200)**: Auto-routes to `flagForInvestigation`.
  - 📍 **Address Unreachable (₹2,450)**: Exceeds threshold; prompts human approval.
  - ⏳ **Customer Unavailable (₹1,150)**: Dispatches automated redelivery with retry policy.
- **Live LangGraph Visualizer**: Interactive visual pipeline highlighting active, paused, and completed nodes with real-time status pulses.
- **Human-in-the-Loop Interrupt Card**: Displays when the graph hits `interrupt()`. Reviewers can inspect the exception summary and click **"Approve Refund"** or **"Reject & Flag for Investigation"** to resume the thread.
- **Audit Log & JSON State Inspector**: Real-time chronological execution logs and collapsible live state viewer (`DeliveryExceptionState`).
- **Dual Execution Engine**:
  - **Live Backend Mode**: Communicates with `src/server.ts` to execute actual Groq LLM inferences and LangGraph state checkpoints.
  - **Zero-Config Simulator Mode**: If opened directly in a browser without running the server, it seamlessly runs high-fidelity client-side simulations matching the exact graph logic.

---

## Backend HTTP Server (`src/server.ts`)

A lightweight HTTP server built with Node's native `node:http` (zero external dependencies) that serves static frontend files and exposes REST API endpoints for LangGraph execution:

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Healthcheck and server status probe. |
| `POST` | `/api/process` | Accepts `{ reportText, courierId, orderId, orderValue, threadId }`, invokes the graph, and returns `{ status: "interrupted" \| "completed", state, interrupt }`. |
| `POST` | `/api/resume` | Resumes a paused thread with `{ threadId, approved: boolean }` using `Command({ resume: { approved } })`. |
| `GET` | `/*` | Serves `public/index.html`, `public/style.css`, and `public/app.js`. |

---

## File Structure

| File | Description |
| --- | --- |
| `public/index.html` | Frontend interface with scenario presets, dispatch form, visual graph pipeline, and HITL approval card. |
| `public/style.css` | Sleek dark theme styling, glassmorphism cards, glowing active node indicators, and responsive grid. |
| `public/app.js` | Frontend controller managing API communication, interactive node animations, and simulation fallback. |
| `src/server.ts` | Zero-dependency HTTP server serving the public frontend and LangGraph REST endpoints. |
| `src/state.ts` | State schema (`DeliveryExceptionState`) and Zod classification types. |
| `src/nodes.ts` | Individual graph node logic, classification prompt, and `Command` routing. |
| `src/graph.ts` | `StateGraph` definition, node registration, retry policies, and compilation. |
| `src/index.ts` | CLI execution script demonstrating graph invocation, interrupt pausing, and resumption. |
| `package.json` | Project metadata (`"type": "module"`), scripts, and dependencies. |
| `tsconfig.json` | TypeScript compiler configuration (`NodeNext`). |

---

## Setup & Running

### Prerequisites
- Node.js 18+
- Groq API Key (from [console.groq.com](https://console.groq.com))

### 1. Installation
```bash
npm install
```

### 2. Environment Configuration
Create `.env` from `.env.example`:
```bash
cp .env.example .env
```
Add your Groq API key:
```env
GROQ_API_KEY=gsk_your_actual_key_here
```

### 3. Run the Frontend (UI)
Start the web server:
```bash
npm run serve
```
Open **`http://localhost:3000`** in your browser.

*(Alternatively, you can double-click or open `public/index.html` directly in your browser to run in local simulator mode).*

### 4. Run the CLI Demo
Execute the terminal-based exception workflow:
```bash
npm run dev
```

---

## Available Scripts

- `npm run serve` - Starts the web server and UI on `http://localhost:3000`.
- `npm run dev` - Runs the CLI demo script `src/index.ts` using `tsx`.
- `npm run build` - Compiles TypeScript to `dist/` using `tsc`.
- `npm start` - Runs the compiled entry point `node dist/index.js`.
