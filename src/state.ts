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

// State schema for delivery exception tracking and routing.
export const DeliveryExceptionState = Annotation.Root({
  reportText: Annotation<string>(),
  courierId: Annotation<string>(),
  orderId: Annotation<string>(),
  orderValue: Annotation<number>(),
  classification: Annotation<ExceptionClassification | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),

  // Resolution summary populated by terminal action nodes prior to finalization.
  resolution: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
});

export type DeliveryExceptionStateType = typeof DeliveryExceptionState.State;
