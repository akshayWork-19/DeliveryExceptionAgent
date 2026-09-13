import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { DeliveryExceptionState } from "./state.js";
import {
  classifyException,
  retryDelivery,
  refundApproval,
  processRefund,
  flagForInvestigation,
  finalizeResolution,
} from "./nodes.js";

const workflow = new StateGraph(DeliveryExceptionState)
  .addNode("classifyException", classifyException, {
    ends: [
      "retryParcelDelivery",
      "exceptionRefundApproval",
      "flagExceptionForInvestigation",
    ],
  })
  .addNode("retryParcelDelivery", retryDelivery, {
    retryPolicy: { maxAttempts: 3 },
    ends: ["finalizeExceptionResolution"],
  })
  .addNode("exceptionRefundApproval", refundApproval, {
    ends: ["generateRefund", "flagExceptionForInvestigation"],
  })
  .addNode("generateRefund", processRefund, {
    ends: ["finalizeExceptionResolution"],
  })
  .addNode("flagExceptionForInvestigation", flagForInvestigation, {
    ends: ["finalizeExceptionResolution"],
  })
  .addNode("finalizeExceptionResolution", finalizeResolution)
  .addEdge(START, "classifyException")
  .addEdge("finalizeExceptionResolution", END);

const checkpointer = new MemorySaver();
export const app = workflow.compile({ checkpointer });
