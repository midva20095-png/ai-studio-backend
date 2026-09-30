# What's new in Gemini 3.8 Flash

{% button href="/docs/models" variant="ais" %}See all models{% /button %}

Gemini 3.8 Flash (`gemini-3.8-flash`) is generally available (GA) and ready for production use. It is our most intelligent Flash model, engineered for long-horizon software engineering, autonomous agents, and complex enterprise workflows.

This guide explains what's new in Gemini 3.8 Flash, API changes, code examples, and migration guidance.

## New model  {% id="new-model" %}

| Model | Model ID | Default thinking level | Pricing | Description |
| :--- | :--- | :---: | --- | :--- |
| Gemini 3.8 Flash | `gemini-3.8-flash` | `medium` | 3.8 Flash is available through the end of year at an introductory price of $0.75/1M input tokens and $3.75/1M output tokens; see [pricing](/docs/pricing) for more details. | Our most intelligent Flash model, engineered for long-horizon software engineering, autonomous agents, and complex enterprise workflows. |

Gemini 3.8 Flash supports a 1M token context window, 64k max output tokens, tunable thinking levels (`low`, `medium`, `high`), and the same suite of built-in tools.

For complete specs, see the [Gemini 3.8 Flash model page](/docs/models/gemini-3.8-flash). For introductory pricing details, see the [pricing section](/docs/latest-model#pricing) below or the [pricing page](/docs/pricing#gemini-3.8-flash).

## Quickstart  {% id="quickstart" %}

{% tabs %}
  {% tab label="Python" %}
  ```python
  from google import genai
  
  client = genai.Client()
  
  interaction = client.interactions.create(
      model="gemini-3.8-flash",
      input="Write a three.js script that renders a realistic 3D black hole."
  )
  
  print(interaction.output_text)
  ```

  {% /tab %}

  {% tab label="JavaScript" %}
  ```javascript
  import { GoogleGenAI } from "@google/genai";
  
  const client = new GoogleGenAI({});
  
  const interaction = await client.interactions.create({
    model: "gemini-3.8-flash",
    input: "Write a three.js script that renders a realistic 3D black hole.",
  });
  
  console.log(interaction.output_text);
  ```

  {% /tab %}

  {% tab label="Java" %}
  ```java
  import com.google.genai.Client;
  import com.google.genai.gaos.models.interactions.CreateModelInteraction;
  import com.google.genai.gaos.models.interactions.Interaction;
  import com.google.genai.gaos.models.interactions.InteractionsInput;
  import com.google.genai.gaos.models.interactions.Model;
  import com.google.genai.gaos.models.operations.CreateInteractionRequestBody;
  
  Client client = new Client();
  
  CreateModelInteraction params =
      CreateModelInteraction.builder()
          .model(Model.of("gemini-3.8-flash"))
          .input(
              InteractionsInput.of(
                  "Write a three.js script that renders a realistic 3D black hole."))
          .build();
  
  Interaction interaction =
      client.interactions.create(CreateInteractionRequestBody.of(params)).interaction().get();
  
  System.out.println(interaction.outputText().orElse(""));
  ```

  {% /tab %}

  {% tab label="Go" %}
  ```go
  package main
  
  import (
      "context"
      "fmt"
      "log"
  
      "google.golang.org/genai"
      "google.golang.org/genai/interactions/models/interactions"
      "google.golang.org/genai/interactions/models/operations"
  )
  
  func main() {
      ctx := context.Background()
      client, err := genai.NewClient(ctx, nil)
      if err != nil {
          log.Fatal(err)
      }
  
      res, err := client.Interactions.Create(ctx, operations.CreateInteractionRequest{
          Body: operations.NewCreateInteractionRequestBody(interactions.CreateModelInteraction{
              Model: interactions.Model("gemini-3.8-flash"),
              Input: interactions.NewInteractionsInput("Write a three.js script that renders a realistic 3D black hole."),
          }),
      })
      if err != nil {
          log.Fatal(err)
      }
      if res.Interaction.OutputText != nil {
          fmt.Println(*res.Interaction.OutputText)
      }
  }
  ```

  {% /tab %}

  {% tab label="REST" %}
  ```bash
  curl "https://generativelanguage.googleapis.com/v1beta/interactions" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -H 'Content-Type: application/json' \
    -X POST \
    -d '{
      "model": "gemini-3.8-flash",
      "input": "Write a three.js script that renders a realistic 3D black hole."
    }'
  ```

  {% /tab %}

{% /tabs %}

## What's new in Gemini 3.8 Flash  {% id="whats-new-gemini-3-8-flash" %}

* **Long-horizon software engineering:** Delivers strong results on real-world coding benchmarks, complex multi-file refactoring, and deterministic tool execution. See the [evaluation methodology](https://deepmind.google/models/evals-methodology/gemini-3-8-flash/) for details.
* **Autonomous agents:** Lets you build resilient multi-step planning and tool orchestration workflows, substantially reducing failed loops and errors.
* **Complex enterprise workflows:** Delivers superior accuracy, deep reasoning, and high factual rigor across demanding domain tasks and large-scale data pipelines.
* **Default model for Managed Agents:** The default agent for managed agents: the [Antigravity agent](/docs/antigravity-agent), now uses Gemini 3.8 Flash. The [Antigravity SDK](https://antigravity.google/docs/sdk/overview/) also uses Gemini 3.8 Flash by default.
* **Introductory pricing:** Gemini 3.8 Flash is available at an introductory rate of $0.75/1M input tokens and $3.75/1M output tokens through December 31, 2026. Standard pricing of $1.50/1M input tokens and $7.50/1M output tokens takes effect January 1, 2027.

Gemini 3.8 Flash can use more tokens on longer running and complex tasks, by design. To deliver higher-quality results on difficult, multi-step goals, the model takes smaller reasoning steps, calls tools iteratively, and verifies its work along the way. Not every workflow needs this level of verification. For everyday tasks, you can lower the [reasoning](/docs/latest-model#understanding-reasoning-levels) effort to reduce token consumption. Alternatively, Gemini 3.7 Flash remains fully supported.

## Understanding reasoning levels  {% id="understanding-reasoning-levels" %}

Gemini 3.8 Flash gives you flexible control over latency and intelligence by adjusting the model's thinking level:

* **Low thinking effort**: Reduces time-to-answer for latency-critical tasks like incident response pipelines, real-time chat, writing drafts, and fast data analysis.
* **Medium (default):** Best quality for most tasks. Recommended for complex code and agentic use cases, providing higher first-pass accuracy.
* **High thinking effort**: Maximizes the model's reasoning and tool orchestration capabilities. Best for deep reasoning, mathematics, and difficult multi-step tasks.

Note: `minimal` thinking level is not supported for Gemini 3.8 Flash and will return an error.

The following example sets `thinking_level` to `medium` for a complex code analysis request:

{% tabs %}
  {% tab label="Python" %}
  ```python
  from google import genai
  
  client = genai.Client()
  
  interaction = client.interactions.create(
      model="gemini-3.8-flash",
      input="Analyze this payment processing pipeline for race conditions during retry attempts and rewrite the transaction locks safely.",
      generation_config={
          "thinking_level": "medium"  # Balanced reasoning effort for complex tasks
      }
  )
  
  print(interaction.output_text)
  ```

  {% /tab %}

  {% tab label="JavaScript" %}
  ```javascript
  import { GoogleGenAI } from "@google/genai";
  
  const client = new GoogleGenAI({});
  
  const interaction = await client.interactions.create({
    model: "gemini-3.8-flash",
    input: "Analyze this payment processing pipeline for race conditions during retry attempts and rewrite the transaction locks safely.",
    generation_config: {
      thinking_level: "medium"
    }
  });
  
  console.log(interaction.output_text);
  ```

  {% /tab %}

  {% tab label="Java" %}
  ```java
  import com.google.genai.Client;
  import com.google.genai.gaos.models.interactions.CreateModelInteraction;
  import com.google.genai.gaos.models.interactions.GenerationConfig;
  import com.google.genai.gaos.models.interactions.Interaction;
  import com.google.genai.gaos.models.interactions.InteractionsInput;
  import com.google.genai.gaos.models.interactions.Model;
  import com.google.genai.gaos.models.interactions.ThinkingLevel;
  import com.google.genai.gaos.models.operations.CreateInteractionRequestBody;
  
  Client client = new Client();
  
  CreateModelInteraction params =
      CreateModelInteraction.builder()
          .model(Model.of("gemini-3.8-flash"))
          .input(
              InteractionsInput.of(
                  "Analyze this payment processing pipeline for race conditions during retry attempts and rewrite the transaction locks safely."))
          .generationConfig(
              GenerationConfig.builder()
                  .thinkingLevel(ThinkingLevel.MEDIUM) // Balanced reasoning effort for complex tasks
                  .build())
          .build();
  
  Interaction interaction =
      client.interactions.create(CreateInteractionRequestBody.of(params)).interaction().get();
  
  System.out.println(interaction.outputText().orElse(""));
  ```

  {% /tab %}

  {% tab label="Go" %}
  ```go
  package main
  
  import (
      "context"
      "fmt"
      "log"
  
      "google.golang.org/genai"
      "google.golang.org/genai/interactions/models/interactions"
      "google.golang.org/genai/interactions/models/operations"
  )
  
  func main() {
      ctx := context.Background()
      client, err := genai.NewClient(ctx, nil)
      if err != nil {
          log.Fatal(err)
      }
  
      res, err := client.Interactions.Create(ctx, operations.CreateInteractionRequest{
          Body: operations.NewCreateInteractionRequestBody(interactions.CreateModelInteraction{
              Model: interactions.Model("gemini-3.8-flash"),
              Input: interactions.NewInteractionsInput("Analyze this payment processing pipeline for race conditions during retry attempts and rewrite the transaction locks safely."),
              GenerationConfig: &interactions.GenerationConfig{
                  ThinkingLevel: interactions.ThinkingLevelMedium.ToPointer(), // Balanced reasoning effort for complex tasks
              },
          }),
      })
      if err != nil {
          log.Fatal(err)
      }
      if res.Interaction.OutputText != nil {
          fmt.Println(*res.Interaction.OutputText)
      }
  }
  ```

  {% /tab %}

  {% tab label="REST" %}
  ```bash
  curl "https://generativelanguage.googleapis.com/v1beta/interactions" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -H 'Content-Type: application/json' \
    -X POST \
    -d '{
      "model": "gemini-3.8-flash",
      "input": "Analyze this payment processing pipeline for race conditions during retry attempts and rewrite the transaction locks safely.",
      "generation_config": {
        "thinking_level": "medium"
      }
    }'
  ```

  {% /tab %}

{% /tabs %}

## Updated Antigravity agent  {% id="updated-antigravity-agent" %}

Due to its improved performance and reasoning, the [Antigravity agent](/docs/antigravity-agent) in Gemini Managed Agents is now built with Gemini 3.8 Flash by default.

{% tabs %}
  {% tab label="Python" %}
  ```python
  from google import genai
  
  client = genai.Client()
  
  interaction = client.interactions.create(
      agent="antigravity-preview-09-2026",
      input=(
          "Audit https://web.dev for performance, Core Web Vitals, and SEO. "
          "Query Google's PageSpeed Insights API for both Mobile and Desktop strategies. "
          "Check search indexing with Google Search for site:web.dev. "
          "Format the output as a side-by-side scorecard table with prioritized fixes."
      ),
      environment="remote",
  )
  
  print(interaction.output_text)
  ```

  {% /tab %}

  {% tab label="JavaScript" %}
  ```javascript
  import { GoogleGenAI } from "@google/genai";
  
  const client = new GoogleGenAI({});
  
  const interaction = await client.interactions.create({
    agent: "antigravity-preview-09-2026",
    input: "Audit https://web.dev for performance, Core Web Vitals, and SEO. Query Google's PageSpeed Insights API for both Mobile and Desktop strategies. Check search indexing with Google Search for site:web.dev. Format the output as a side-by-side scorecard table with prioritized fixes.",
    environment: "remote",
  }, { timeout: 300000 });
  
  console.log(interaction.output_text);
  ```

  {% /tab %}

  {% tab label="Java" %}
  ```java
  import com.google.genai.Client;
  import com.google.genai.gaos.models.interactions.AgentOption;
  import com.google.genai.gaos.models.interactions.CreateAgentInteraction;
  import com.google.genai.gaos.models.interactions.CreateAgentInteractionEnvironment;
  import com.google.genai.gaos.models.interactions.Interaction;
  import com.google.genai.gaos.models.interactions.InteractionsInput;
  import com.google.genai.gaos.models.operations.CreateInteractionRequestBody;
  
  Client client = new Client();
  
  CreateAgentInteraction params =
      CreateAgentInteraction.builder()
          .agent(AgentOption.of("antigravity-preview-09-2026"))
          .input(
              InteractionsInput.of(
                  "Audit https://web.dev for performance, Core Web Vitals, and SEO. "
                      + "Query Google's PageSpeed Insights API for both Mobile and Desktop strategies. "
                      + "Check search indexing with Google Search for site:web.dev. "
                      + "Format the output as a side-by-side scorecard table with prioritized fixes."))
          .environment(CreateAgentInteractionEnvironment.of("remote"))
          .build();
  
  Interaction interaction =
      client.interactions.create(CreateInteractionRequestBody.of(params)).interaction().get();
  
  System.out.println(interaction.outputText().orElse(""));
  ```

  {% /tab %}

  {% tab label="Go" %}
  ```go
  package main
  
  import (
      "context"
      "fmt"
      "log"
  
      "google.golang.org/genai"
      "google.golang.org/genai/interactions/models/interactions"
      "google.golang.org/genai/interactions/models/operations"
  )
  
  func main() {
      ctx := context.Background()
      client, err := genai.NewClient(ctx, nil)
      if err != nil {
          log.Fatal(err)
      }
  
      res, err := client.Interactions.Create(ctx, operations.CreateInteractionRequest{
          Body: operations.NewCreateInteractionRequestBody(interactions.CreateAgentInteraction{
              Agent: interactions.AgentOption("antigravity-preview-09-2026"),
              Input: interactions.NewInteractionsInput(
                  "Audit https://web.dev for performance, Core Web Vitals, and SEO. " +
                      "Query Google's PageSpeed Insights API for both Mobile and Desktop strategies. " +
                      "Check search indexing with Google Search for site:web.dev. " +
                      "Format the output as a side-by-side scorecard table with prioritized fixes.",
              ),
              Environment: genai.Ptr(interactions.NewCreateAgentInteractionEnvironment("remote")),
          }),
      })
      if err != nil {
          log.Fatal(err)
      }
      if res.Interaction.OutputText != nil {
          fmt.Println(*res.Interaction.OutputText)
      }
  }
  ```

  {% /tab %}

  {% tab label="REST" %}
  ```shell
  curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -d '{
      "agent": "antigravity-preview-09-2026",
      "input": "Audit https://web.dev for performance, Core Web Vitals, and SEO. Query Google'\''s PageSpeed Insights API for both Mobile and Desktop strategies. Check search indexing with Google Search for site:web.dev. Format the output as a side-by-side scorecard table with prioritized fixes.",
      "environment": "remote"
  }'
  ```

  {% /tab %}

{% /tabs %}

The underlying Gemini model [can be configured](/docs/antigravity-agent#model-selection) using `agent_config`.

## Migration checklist  {% id="migration-checklist" %}

{% callout type="note" %}
  **Automate this migration with a coding agent.** If you use a coding agent that supports skills (like Antigravity),
  install the [gemini-api-dev skill](/docs/coding-agents#gemini-api-dev) and run:

  `/gemini-api-dev migrate my app to Gemini 3.8 Flash`

{% /callout %}

### Migrate to gemini-3.8-flash  {% id="migrate-to-gemini-3-8-flash" %}

* **Update Model ID:** Change your target model string to `gemini-3.8-flash`.
* **Remove deprecated sampling parameters:**  * Strip `temperature`, `top_p`, and `top_k` from generation configs.
  * Replace `thinking_budget` with the string enum `thinking_level`. Note that `minimal` is not supported on 3.8 Flash.
  * Remove `candidate_count` (unsupported in Gemini 3 and later).

* **Enforce turn validation rules:**  * Standardize multi-turn conversations on server-side `previous_interaction_id`.
  * Remove prefilled model turns.

* **Audit function calling:**  * Place multimodal assets inside the response payload.
  * Format inline instructions using `\n\n`.
  * If you see `Malformed_Function_Call` errors tied to pre-tool text, see [Workarounds for pre-tool text requirements](/docs/function-calling#workarounds-for-pre-tool-text-requirements).
  * Only if using generateContent API: Ensure all `FunctionResponse` objects include `call_id` and `name`.

* **Baseline Gemini 3 requirements:** For SDK updates and thought signature preservation, see the [Gemini 3.5 Migration Checklist](/docs/whats-new-gemini-3.5#migration).

## Pricing  {% id="pricing" %}

Take advantage of introductory pricing across Google AI Studio and Gemini Enterprise Agent Platform through December 31, 2026 for Gemini 3.8 Flash, Gemini 3.7 Flash, and Gemini 3.6 Flash. Standard pricing takes effect January 1, 2027. For complete pricing tiers, see the [pricing page](/docs/pricing#gemini-3.8-flash).

## Next steps  {% id="next-steps" %}

* Review API specs on the [Models Overview](/docs/models).
* Explore multi-agent orchestration in the [Interactions API Overview](/docs/interactions-overview).
* Test and refine prompts in [Google AI Studio](https://aistudio.google.com/prompts/new_chat?model=gemini-3.8-flash).

