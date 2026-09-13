import { Annotation } from "@langchain/langgraph";
import z from "zod";

export const ExceptionClassificationSchema = z.object({
  exceptionType: z.enum([
    "address_unreachable",
    "customer_refused",
    "package_damaged",
    "customer_unavailable",
    "other",
  ]),
  summary: z.string(),
});

export type ExceptionClassification = z.infer<
  typeof ExceptionClassificationSchema
>;

/**
 * The field that makes this project different from the email agent:
 * `orderValue`. classifyException routes on TWO fields together
 * (exceptionType AND orderValue), not one field alone. Same raw-data
 * principle as before — orderValue is a plain number in state, not
 * baked into a prompt string, so any node can use it for its own logic
 * without re-deriving it.
 */

export const DeliveryExceptionState = Annotation.Root({
  reportText: Annotation<string>(),
  courierId: Annotation<string>(),
  orderId: Annotation<string>(),
  orderValue: Annotation<number>(),
  classification: Annotation<ExceptionClassification | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),

  // Set by whichever terminal node handles the case (retryDelivery,
  // processRefund, or flagForInvestigation) — this is the CONVERGENCE
  // point: three different paths through the graph, but they all
  // write the same field before reaching finalizeResolution. The
  // email agent never had this — every path there ended at sendReply
  // directly. Here, finalizeResolution is a single node several
  // branches route INTO, which is a different shape worth noticing.
  resolution: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
});

export type DeliveryExceptionStateType = typeof DeliveryExceptionState.State;
