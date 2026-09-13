import "dotenv/config";
import { Command } from "@langchain/langgraph";
import { app } from "./graph.js";

async function main() {
  const config = {
    configurable: {
      thread_id: "order_9881",
    },
  };

  const initialState = {
    reportText: "Kindly approve my refund, i dont need the product anymore",
    courierId: "courier-55",
    orderId: "order-9881",
    orderValue: 4999,
  };

  console.log("--- Running graph ---");
  const result = await app.invoke(initialState, config);
  console.log("Result after first invoke:", JSON.stringify(result, null, 2));

  const snap = await app.getState(config);
  console.log("\n snap.next (paused at) ", snap.next);

  if (snap.next.length === 0) {
    console.log("\n Graph already ran to completion - nothing to resume");
    return;
  }

  console.log("\n Resuming with human decision!");
  const resumed = await app.invoke(
    new Command({
      resume: {
        approved: false,
      },
    }),
    config,
  );

  console.log("\n final state:", JSON.stringify(resumed, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
