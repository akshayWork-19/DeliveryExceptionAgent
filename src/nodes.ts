import { ChatGroq } from "@langchain/groq";
import { Command, interrupt } from "@langchain/langgraph";
import {
  DeliveryExceptionState,
  ExceptionClassificationSchema,
} from "./state.js";

const llm = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY,
  model: "openai/gpt-oss-20b",
  temperature: 0.7,
});

type State = typeof DeliveryExceptionState.State;

const REFUND_APPROVAL_THRESHOLD = 2000;

export async function classifyException(state: State): Promise<Command> {
  const structuredLlm = llm.withStructuredOutput(ExceptionClassificationSchema);

  const prompt = `
  Classify this courier's delivery exception report.

Categories:
- "address_unreachable": courier couldn't physically reach the address
- "customer_refused": customer refused delivery / declined the package
- "package_damaged": package arrived damaged or was damaged in transit
- "customer_unavailable": customer wasn't there, no answer, will retry
- "other": anything that doesn't fit the above

  Report :${state.reportText}
  Order Id:${state.orderId}
`;

  const classification = await structuredLlm.invoke(prompt);

  // The routing logic itself — trace this by hand before running:
  // damaged packages ALWAYS go to investigation regardless of value.
  // refused/unreachable only need a human if the order is expensive
  // enough that an automatic refund is risky. Everything else just
  // gets retried.

  let goto: string;

  if (classification.exceptionType === "package_damaged") {
    goto = "flagExceptionForInvestigation";
  } else if (
    classification.exceptionType === "customer_refused" ||
    classification.exceptionType === "address_unreachable"
  ) {
    goto =
      state.orderValue > REFUND_APPROVAL_THRESHOLD
        ? "exceptionRefundApproval"
        : "retryParcelDelivery";
  } else {
    goto = "retryParcelDelivery";
  }
  console.log(`[classifyException] routing to: ${goto}`);
  return new Command({
    update: { classification },
    goto,
  });
}

// ---------------------------------------------------------------------
// AUTOMATIC PATH — no human involved, but wrapped in a retry policy
// (configured in graph.ts) since this represents an external dispatch
// API call that can genuinely fail transiently.
// --------------------------------------------------------------------

let retryAttempts = 0;

export async function retryDelivery(state: State): Promise<Command> {
  retryAttempts += 1;
  console.log(`[retryDelivery] attempt #${retryAttempts}`);

  // Toggle this to simulate a flaky dispatch API, same exercise as
  // the email agent's searchDocumentation. Leave as false for normal runs.
  const SIMULATE_FLAKY_CALL = true;
  if (SIMULATE_FLAKY_CALL && retryAttempts < 3) {
    throw new Error(
      `Simulated dispatch API failure on attempt #${retryAttempts}`,
    );
  }

  return new Command({
    update: { resolution: `Redelivery scheduled for order ${state.orderId}` },
    goto: "finalizeExceptionResolution",
  });
}

// ---------------------------------------------------------------------
// HUMAN-GATED PATH — refund above threshold needs sign-off.
// ---------------------------------------------------------------------

export async function refundApproval(state: State): Promise<Command> {
  const decision = interrupt({
    orderId: state.orderId,
    orderValue: state.orderValue,
    exceptionType: state.classification?.exceptionType,
    summary: state.classification?.summary,
    action: `Approve refund of order value (₹${state.orderValue})`,
  }) as { approved: boolean };

  if (decision.approved) {
    return new Command({
      update: {},
      goto: "generateRefund",
    });
  }

  return new Command({
    update: {},
    goto: "flagExceptionForInvestigation",
  });
}

export async function processRefund(state: State): Promise<Command> {
  return new Command({
    update: {
      resolution: `Refund of ₹${state.orderValue} processed for order ${state.orderId}`,
    },
    goto: "finalizeExceptionResolution",
  });
}

// ---------------------------------------------------------------------
// ALWAYS-HUMAN PATH — package damage, or a rejected refund.
// ---------------------------------------------------------------------

export async function flagForInvestigation(state: State): Promise<Command> {
  const ticketId = "INV-00042";
  return new Command({
    update: {
      resolution: `Investigation ticket ${ticketId} opened for ${state.orderId}`,
    },
    goto: "finalizeExceptionResolution",
  });
}

export async function finalizeResolution(state: State) {
  console.log(`Resolution for ${state.orderId} :${state.resolution}`);
  return {};
}
