/**
 * DeliveryExceptionAgent - Frontend Logic & LangGraph Visualizer
 */

// Preset Scenarios
const PRESETS = {
  "refused-high": {
    orderId: "order-9881",
    courierId: "courier-55",
    orderValue: 4999,
    reportText: "Kindly approve my refund, i dont need the product anymore",
  },
  "refused-low": {
    orderId: "order-4210",
    courierId: "courier-12",
    orderValue: 850,
    reportText: "Customer refused parcel at door due to change of mind",
  },
  "damaged": {
    orderId: "order-7721",
    courierId: "courier-89",
    orderValue: 3200,
    reportText: "Package carton crushed and contents leaking during transit",
  },
  "unreachable": {
    orderId: "order-3319",
    courierId: "courier-44",
    orderValue: 2450,
    reportText: "Delivery address is blocked by construction and physically unreachable",
  },
  "unavailable": {
    orderId: "order-1102",
    courierId: "courier-07",
    orderValue: 1150,
    reportText: "Door locked, customer phone ringing with no answer, will reattempt tomorrow",
  },
};

// State tracking
let currentThreadId = null;
let currentPendingInterrupt = null;
let isBackendLive = false;
let latestState = {};

// DOM Elements
const serverStatusBadge = document.getElementById("serverStatusBadge");
const serverStatusText = document.getElementById("serverStatusText");
const statusDot = serverStatusBadge.querySelector(".status-dot");
const workflowStatusBadge = document.getElementById("workflowStatusBadge");

const exceptionForm = document.getElementById("exceptionForm");
const orderIdInput = document.getElementById("orderId");
const courierIdInput = document.getElementById("courierId");
const orderValueInput = document.getElementById("orderValue");
const reportTextInput = document.getElementById("reportText");
const submitBtn = document.getElementById("submitBtn");
const btnText = submitBtn.querySelector(".btn-text");
const btnSpinner = submitBtn.querySelector(".btn-spinner");

const hitlCard = document.getElementById("hitlCard");
const hitlThreadId = document.getElementById("hitlThreadId");
const hitlActionText = document.getElementById("hitlActionText");
const hitlOrderId = document.getElementById("hitlOrderId");
const hitlOrderValue = document.getElementById("hitlOrderValue");
const hitlExceptionType = document.getElementById("hitlExceptionType");
const hitlSummaryText = document.getElementById("hitlSummaryText");
const approveRefundBtn = document.getElementById("approveRefundBtn");
const rejectRefundBtn = document.getElementById("rejectRefundBtn");

const outcomeCard = document.getElementById("outcomeCard");
const outcomeBadge = document.getElementById("outcomeBadge");
const outcomeTime = document.getElementById("outcomeTime");
const outcomeResolutionText = document.getElementById("outcomeResolutionText");
const outcomeExceptionType = document.getElementById("outcomeExceptionType");
const outcomeOrderValue = document.getElementById("outcomeOrderValue");
const outcomeSummary = document.getElementById("outcomeSummary");

const auditLog = document.getElementById("auditLog");
const toggleJsonBtn = document.getElementById("toggleJsonBtn");
const jsonViewer = document.getElementById("jsonViewer");
const jsonCode = document.getElementById("jsonCode");

const flowNodes = {
  classify: document.getElementById("node-classifyException"),
  retry: document.getElementById("node-retryParcelDelivery"),
  approval: document.getElementById("node-exceptionRefundApproval"),
  investigate: document.getElementById("node-flagExceptionForInvestigation"),
  refund: document.getElementById("node-generateRefund"),
  finalize: document.getElementById("node-finalizeExceptionResolution"),
};

// -------------------------------------------------------------
// Logging Helper
// -------------------------------------------------------------
function addLog(message, type = "info") {
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${escapeHtml(message)}</span>`;
  auditLog.appendChild(entry);
  auditLog.scrollTop = auditLog.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.innerText = text;
  return div.innerHTML;
}

function updateStateJson(state) {
  latestState = state;
  jsonCode.textContent = JSON.stringify(state, null, 2);
}

// -------------------------------------------------------------
// Workflow Visualizer Helpers
// -------------------------------------------------------------
function clearNodeHighlights() {
  Object.values(flowNodes).forEach((node) => {
    node.classList.remove("active", "completed", "interrupted");
  });
}

function setNodeStatus(nodeKey, status) {
  const node = flowNodes[nodeKey];
  if (!node) return;
  node.classList.remove("active", "completed", "interrupted");
  if (status) {
    node.classList.add(status);
  }
}

// -------------------------------------------------------------
// Server Health Check
// -------------------------------------------------------------
async function checkBackendHealth() {
  try {
    const res = await fetch("/api/health");
    if (res.ok) {
      const data = await res.json();
      isBackendLive = true;
      statusDot.className = "status-dot online";
      serverStatusText.textContent = "Backend Live (Groq LLM)";
      addLog("Connected to LangGraph backend server.", "success");
      return;
    }
  } catch (_e) {
    // Backend offline or running file directly
  }

  isBackendLive = false;
  statusDot.className = "status-dot offline";
  serverStatusText.textContent = "Interactive Simulator Mode";
  addLog("Backend server not detected. Running high-fidelity local simulator for all graph paths.", "info");
}

// -------------------------------------------------------------
// Presets Loader
// -------------------------------------------------------------
document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.getAttribute("data-preset");
    const preset = PRESETS[key];
    if (!preset) return;

    orderIdInput.value = preset.orderId;
    courierIdInput.value = preset.courierId;
    orderValueInput.value = preset.orderValue;
    reportTextInput.value = preset.reportText;

    addLog(`Loaded preset: "${btn.querySelector('strong').innerText}" (₹${preset.orderValue})`, "info");
  });
});

// Toggle JSON Inspector
toggleJsonBtn.addEventListener("click", () => {
  const isHidden = jsonViewer.classList.toggle("hidden");
  toggleJsonBtn.textContent = isHidden ? "View Raw JSON" : "Hide Raw JSON";
});

// -------------------------------------------------------------
// Form Submission & Flow Execution
// -------------------------------------------------------------
exceptionForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    orderId: orderIdInput.value.trim(),
    courierId: courierIdInput.value.trim(),
    orderValue: Number(orderValueInput.value),
    reportText: reportTextInput.value.trim(),
    threadId: `order_${orderIdInput.value.replace(/[^a-zA-Z0-9]/g, "")}_${Date.now().toString().slice(-4)}`,
  };

  currentThreadId = payload.threadId;

  // Reset UI
  hitlCard.classList.add("hidden");
  outcomeCard.classList.add("hidden");
  clearNodeHighlights();

  submitBtn.disabled = true;
  btnSpinner.classList.remove("hidden");
  btnText.textContent = "Processing...";
  workflowStatusBadge.textContent = "Running";
  workflowStatusBadge.className = "panel-tag active";

  addLog(`--- Starting Exception Workflow [${payload.orderId}] ---`, "info");
  setNodeStatus("classify", "active");
  addLog(`[classifyException] Analyzing report: "${payload.reportText}"`, "info");

  if (isBackendLive) {
    await executeViaBackend(payload);
  } else {
    await executeViaSimulation(payload);
  }
});

// -------------------------------------------------------------
// Backend API Execution
// -------------------------------------------------------------
async function executeViaBackend(payload) {
  try {
    const res = await fetch("/api/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to process");
    }

    handleWorkflowResponse(data);
  } catch (err) {
    addLog(`Error executing workflow: ${err.message}`, "error");
    workflowStatusBadge.textContent = "Error";
    workflowStatusBadge.className = "panel-tag";
    submitBtn.disabled = false;
    btnSpinner.classList.add("hidden");
    btnText.textContent = "Execute Exception Agent";
  }
}

// -------------------------------------------------------------
// Simulation Engine (Exact duplicate of LangGraph rules in nodes.ts)
// -------------------------------------------------------------
async function executeViaSimulation(payload) {
  await new Promise((r) => setTimeout(r, 600));

  // Determine classification from text
  const text = payload.reportText.toLowerCase();
  let exceptionType = "other";
  let summary = payload.reportText;

  if (text.includes("damaged") || text.includes("crushed") || text.includes("broken") || text.includes("leaking")) {
    exceptionType = "package_damaged";
    summary = "Package arrived damaged or was damaged in transit";
  } else if (text.includes("refund") || text.includes("refused") || text.includes("declined") || text.includes("dont need")) {
    exceptionType = "customer_refused";
    summary = "Customer refused delivery or requested immediate refund";
  } else if (text.includes("unreachable") || text.includes("address") || text.includes("blocked") || text.includes("flooding")) {
    exceptionType = "address_unreachable";
    summary = "Courier could not physically reach the delivery address";
  } else if (text.includes("unavailable") || text.includes("no answer") || text.includes("locked") || text.includes("not there")) {
    exceptionType = "customer_unavailable";
    summary = "Customer was unavailable at time of delivery attempt";
  } else {
    exceptionType = "other";
    summary = "Courier delivery exception logged";
  }

  const state = {
    ...payload,
    classification: {
      exceptionType,
      summary,
    },
    resolution: null,
  };

  setNodeStatus("classify", "completed");
  addLog(`[classifyException] Classified as "${exceptionType}": ${summary}`, "success");
  updateStateJson(state);

  // Routing Logic
  const REFUND_THRESHOLD = 2000;

  if (exceptionType === "package_damaged") {
    addLog("[Routing] Damaged goods detected -> Routing to flagExceptionForInvestigation", "warn");
    await simulateInvestigation(state);
  } else if (exceptionType === "customer_refused" || exceptionType === "address_unreachable") {
    if (state.orderValue > REFUND_THRESHOLD) {
      addLog(`[Routing] High value order (₹${state.orderValue} > ₹${REFUND_THRESHOLD}) -> Pausing at exceptionRefundApproval for Human HITL`, "warn");
      triggerHitlInterrupt({
        orderId: state.orderId,
        orderValue: state.orderValue,
        exceptionType,
        summary,
        action: `Approve refund of order value (₹${state.orderValue})`,
      }, state);
    } else {
      addLog(`[Routing] Order value (₹${state.orderValue} <= ₹${REFUND_THRESHOLD}) -> Routing to retryParcelDelivery`, "info");
      await simulateRetryDelivery(state);
    }
  } else {
    addLog("[Routing] Routing to retryParcelDelivery", "info");
    await simulateRetryDelivery(state);
  }
}

async function simulateRetryDelivery(state) {
  setNodeStatus("retry", "active");
  addLog("[retryDelivery] Attempting automated redelivery dispatch (Policy: max 3 attempts)...", "info");
  
  await new Promise((r) => setTimeout(r, 800));
  addLog("[retryDelivery] Retry attempt #1: dispatch confirmed.", "info");
  setNodeStatus("retry", "completed");

  state.resolution = `Redelivery scheduled for order ${state.orderId}`;
  await simulateFinalize(state);
}

async function simulateInvestigation(state) {
  setNodeStatus("investigate", "active");
  addLog("[flagForInvestigation] Opening high-priority carrier inspection ticket...", "info");
  
  await new Promise((r) => setTimeout(r, 700));
  const ticketId = "INV-00042";
  setNodeStatus("investigate", "completed");
  state.resolution = `Investigation ticket ${ticketId} opened for ${state.orderId}`;
  await simulateFinalize(state);
}

async function simulateFinalize(state) {
  setNodeStatus("finalize", "active");
  await new Promise((r) => setTimeout(r, 400));
  setNodeStatus("finalize", "completed");

  addLog(`[finalizeResolution] Resolution: "${state.resolution}"`, "success");
  updateStateJson(state);
  displayOutcome(state);
  finishRun();
}

// -------------------------------------------------------------
// Handle Workflow Response from Backend or Simulation
// -------------------------------------------------------------
function handleWorkflowResponse(data) {
  updateStateJson(data.state);

  if (data.status === "interrupted") {
    setNodeStatus("classify", "completed");
    triggerHitlInterrupt(data.interrupt, data.state);
  } else if (data.status === "completed") {
    setNodeStatus("classify", "completed");
    const state = data.state;

    // Highlight appropriate paths
    if (state.resolution?.includes("Refund")) {
      setNodeStatus("approval", "completed");
      setNodeStatus("refund", "completed");
    } else if (state.resolution?.includes("Investigation")) {
      setNodeStatus("investigate", "completed");
    } else {
      setNodeStatus("retry", "completed");
    }

    setNodeStatus("finalize", "completed");
    displayOutcome(state);
    finishRun();
  }
}

// -------------------------------------------------------------
// HITL Interrupt Handler
// -------------------------------------------------------------
function triggerHitlInterrupt(interruptData, state) {
  currentPendingInterrupt = { interruptData, state };

  setNodeStatus("approval", "interrupted");
  workflowStatusBadge.textContent = "Paused (Interrupt)";
  workflowStatusBadge.className = "panel-tag active";

  hitlThreadId.textContent = `Thread: ${currentThreadId}`;
  hitlActionText.textContent = interruptData.action || `Approve refund of order value (₹${state.orderValue})`;
  hitlOrderId.textContent = state.orderId;
  hitlOrderValue.textContent = `₹${Number(state.orderValue).toLocaleString()}`;
  hitlExceptionType.textContent = state.classification?.exceptionType || interruptData.exceptionType || "Exception";
  hitlSummaryText.textContent = state.classification?.summary || interruptData.summary || "No summary provided";

  hitlCard.classList.remove("hidden");
  hitlCard.scrollIntoView({ behavior: "smooth", block: "nearest" });

  submitBtn.disabled = true;
  btnSpinner.classList.add("hidden");
  btnText.textContent = "Paused for Review";

  addLog(`🚨 INTERRUPT: Workflow paused at exceptionRefundApproval. Human decision required!`, "warn");
}

// HITL Decision Buttons
approveRefundBtn.addEventListener("click", () => resumeInterrupt(true));
rejectRefundBtn.addEventListener("click", () => resumeInterrupt(false));

async function resumeInterrupt(approved) {
  approveRefundBtn.disabled = true;
  rejectRefundBtn.disabled = true;

  addLog(`[HITL Decision] Human reviewer decided: ${approved ? "APPROVED" : "REJECTED"} refund`, approved ? "success" : "warn");

  if (isBackendLive) {
    try {
      const res = await fetch("/api/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: currentThreadId,
          approved,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to resume");

      hitlCard.classList.add("hidden");
      setNodeStatus("approval", "completed");

      if (approved) {
        setNodeStatus("refund", "completed");
      } else {
        setNodeStatus("investigate", "completed");
      }

      setNodeStatus("finalize", "completed");
      displayOutcome(data.state);
      updateStateJson(data.state);
      finishRun();
    } catch (err) {
      addLog(`Error resuming: ${err.message}`, "error");
    } finally {
      approveRefundBtn.disabled = false;
      rejectRefundBtn.disabled = false;
    }
  } else {
    // Simulation resume
    const state = currentPendingInterrupt.state;
    hitlCard.classList.add("hidden");
    setNodeStatus("approval", "completed");

    if (approved) {
      setNodeStatus("refund", "active");
      addLog(`[generateRefund] Processing automated refund payment of ₹${state.orderValue}...`, "info");
      await new Promise((r) => setTimeout(r, 600));
      setNodeStatus("refund", "completed");
      state.resolution = `Refund of ₹${state.orderValue} processed for order ${state.orderId}`;
    } else {
      setNodeStatus("investigate", "active");
      addLog(`[flagExceptionForInvestigation] Refund rejected. Escalating to human investigation...`, "warn");
      await new Promise((r) => setTimeout(r, 600));
      setNodeStatus("investigate", "completed");
      state.resolution = `Investigation ticket INV-00042 opened for ${state.orderId}`;
    }

    await simulateFinalize(state);
    approveRefundBtn.disabled = false;
    rejectRefundBtn.disabled = false;
  }
}

// -------------------------------------------------------------
// Display Outcome
// -------------------------------------------------------------
function displayOutcome(state) {
  outcomeCard.classList.remove("hidden");
  outcomeTime.textContent = new Date().toLocaleTimeString();
  outcomeResolutionText.textContent = state.resolution || "Resolved";
  outcomeExceptionType.textContent = state.classification?.exceptionType || "N/A";
  outcomeOrderValue.textContent = `₹${Number(state.orderValue).toLocaleString()}`;
  outcomeSummary.textContent = state.classification?.summary || "Completed";

  addLog(`✅ Workflow completed. Final resolution applied.`, "success");
}

function finishRun() {
  submitBtn.disabled = false;
  btnSpinner.classList.add("hidden");
  btnText.textContent = "Execute Exception Agent";
  workflowStatusBadge.textContent = "Completed";
  workflowStatusBadge.className = "panel-tag";
}

// Initial check
checkBackendHealth();
