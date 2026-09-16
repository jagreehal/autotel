---
'autotel-devtools': patch
---

GenAI tab reads cache-write tokens from `gen_ai.usage.cache_write.input_tokens` as well as the earlier `gen_ai.usage.cache_creation.input_tokens`, so cost and usage stay correct for spans from either convention version.
