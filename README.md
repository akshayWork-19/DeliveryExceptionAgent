# delivery-exception-agent

Chatbot #3: a courier delivery exception handler. Same core patterns as the email agent (`Command` routing, `interrupt()`, `retryPolicy`), but the new thing here is **routing on two fields together**, and a **convergence point** where three separate paths land on one node before END.

## Setup

```bash
npm install
cp .env.example .env   # add your GROQ_API_KEY
npm run dev
```

## What's different from the email agent

- `classifyException` routes on `exceptionType` AND `orderValue` together — a damaged package always goes to investigation regardless of value; a refused/unreachable delivery only needs human approval if the order is expensive enough (`REFUND_APPROVAL_THRESHOLD` in `nodes.ts`).
- Three separate terminal paths (`retryDelivery`, `processRefund`, `flagForInvestigation`) all write to the same `resolution` field and route into `finalizeResolution` before `END` — a converging graph shape, not just a branching one.
- A rejected refund doesn't dead-end — `refundApproval`'s `Command` routes to `flagForInvestigation` on rejection, same as approval routes to `processRefund`. Two outcomes from one interrupt, not just approve/nothing.

## What to poke at

- Trace the routing logic in `classifyException` by hand for a few made-up reports before running them. Predict the path, then check `snap.next` or the final `resolution` to see if you were right.
- Change `orderValue` in `index.ts` to something under ₹2000 with the same `customer_refused` report — confirm it skips `refundApproval` entirely.
- Set `SIMULATE_FLAKY_CALL = true` in `retryDelivery` (same pattern as the email agent's `searchDocumentation` exercise) and confirm the retry policy logs the same 1s/2s backoff.
- Reject the refund instead of approving it (`resume: { approved: false }` in `index.ts`) and confirm `resolution` ends up mentioning an investigation ticket, not a refund — that's the "two outcomes from one interrupt" path.
- `finalizeResolution` currently just logs. In a real system this is probably where you'd write to a DB or notify the courier — ask yourself whether that belongs in this node or should be its own node, using the same "do I need to observe/retry this independently" test from earlier.
