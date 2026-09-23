---
'autotel': minor
'autotel-genai': minor
---

`requestCtx` attributes now reach every span the request starts afterwards, such as handlers, database calls and outgoing HTTP. Set `user.id` in auth middleware and you can filter on it anywhere in the trace. The copy stays in-process and never rides baggage. A span's own value for a key wins.

New in `autotel-genai`: `runConversationSignals()` and `CONVERSATION_SIGNAL_QUESTIONS` ask five yes/no questions about a conversation (frustration, follow-up, disagreement, resolved, agent corrected) in one pass through an evaluation model such as TypeSafe Jev. `wrapEvaluationModel` accepts `booleanThresholds`, so each answer lands as a `gen_ai.evaluation.result` labelled `yes` or `no`.
