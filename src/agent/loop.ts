// src/agent/loop.ts
//
// ReAct agent state machine on Gemini 2.5 Flash with the three PoC
// tools. Plain TypeScript — no framework magic.
//
// runAgentLoop(userMessage, ctx, callbacks):
//   1. Send user message + tool schemas to Gemini
//   2. If Gemini returns tool calls, execute each, append results
//   3. Loop until Gemini returns a final text answer OR max turns hit
//   4. Max turns = 4 for PoC budget
//
// Callbacks fire on:
//   - toolCallStart(name, args)
//   - toolCallEnd(name, result)
//   - finalAnswer(text)
//   - error(message)

import { geminiComplete, type GeminiContent } from "../data/llm";
import { TOOL_SCHEMAS } from "./schema";
import { JARVIS_SYSTEM_PROMPT } from "./prompts";
import { runTool, type ToolContext, type ToolResult } from "./tools";
import {
  applyFormattingTemplate,
  applyHallucinationGuard,
  applyPostToolValidator,
  collectPrePromptAugmentations,
  runIntentClassifier,
} from "./rules-engine";
import type { OperacionCalculo, TotalesSpec } from "../quantification/types";

const MAX_TURNS = 6; // bumped 4→6 because RAG-before-filter (consultar_base_de_conocimiento → resaltar_elementos) consumes 2 turns

// Boss 2026-08-05 — prose-injection guardrail for `calcular_cantidades`.
// When the consultar_base_de_conocimiento tool returns a table with
// `totales`, we inject the formatted total into the LLM's context
// so the prose response reports the exact value, not a hallucinated
// recomputation. The Spanish label matches the prose surface.
const OP_LABEL: Record<OperacionCalculo, string> = {
  suma: "Suma",
  promedio: "Promedio",
  min: "Mínimo",
  max: "Máximo",
};

function formatTotalesForProse(t: TotalesSpec): string {
  const label = OP_LABEL[t.operacion] ?? t.operacion;
  const formatted = t.unidad
    ? `${t.valor.toFixed(3)} ${t.unidad}`
    : t.valor.toFixed(3);
  return `[Cálculo exacto del tool — usa este valor exacto en tu prosa, NO recalcules] ${label} de '${t.columna}': ${formatted}`;
}

// The tool result union doesn't expose `tabla` on every variant —
// we narrow with a typed cast after the tool-name check.
type ConsultarResultWithTotales = { tabla?: { totales?: TotalesSpec } };

export interface AgentCallbacks {
  onToolCallStart?: (name: string, args: Record<string, unknown>) => void;
  onToolCallEnd?: (name: string, result: ToolResult) => void;
  onFinalAnswer?: (text: string) => void;
  onError?: (message: string) => void;
}

export async function runAgentLoop(
  userMessage: string,
  ctx: ToolContext,
  callbacks: AgentCallbacks = {},
  signal?: AbortSignal,
  // Boss 2026-08-05 R1 — table-state preamble injected as a
  // user-role part before the user's actual message. Null/undefined
  // skips the injection (default). Built by
  // buildTableContextPreamble() in tools.ts; carried through
  // App.tsx → handleSend.
  tableContext?: string,
): Promise<string> {
  // Boss 2026-08-05 (Extensibility — Hook 4: intent-classifier).
  // Short-circuit greetings, thanks, capability queries, and
  // goodbyes with canned responses. Saves the API spend on the
  // prompt + a model turn. Formatting-template may still apply if
  // its rule doesn't set skip_when_short_circuit; hallucination-
  // guard self-skips (it requires tool data to cross-check).
  const intent = runIntentClassifier(userMessage);
  if (intent) {
    const finalText = applyFormattingTemplate(intent.canned_response, {
      shortCircuited: true,
    });
    callbacks.onFinalAnswer?.(finalText);
    return finalText;
  }
  // Boss 2026-08-05 (Extensibility — Hook 1: pre-prompt-augmentation).
  // Augmentations run after the intent-classifier short-circuit and
  // before the R1 table-state preamble. The LLM sees policy hints
  // first, then state, then the user's actual question.
  const augmentations = collectPrePromptAugmentations(userMessage);
  // Track every tool result this turn so Hook 3 (hallucination-guard)
  // can cross-check the final prose against tool-reported totales.
  const toolResults: Array<{ tool: string; result: unknown }> = [];
  const userParts: GeminiContent["parts"] = [];
  for (const aug of augmentations) {
    userParts.push({ text: aug });
  }
  if (tableContext) {
    userParts.push({ text: tableContext });
  }
  userParts.push({ text: userMessage });
  const contents: GeminiContent[] = [{ role: "user", parts: userParts }];
  let finalText = "";
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    if (signal?.aborted) throw new Error("Cancelado por el usuario.");
    const response = await geminiComplete(
      {
        contents,
        tools: [{ functionDeclarations: TOOL_SCHEMAS }],
        systemInstruction: { parts: [{ text: JARVIS_SYSTEM_PROMPT }] },
      },
      signal,
    );
    const candidate = response.candidates?.[0];
    if (!candidate) {
      const msg = "Gemini no devolvió candidatos.";
      callbacks.onError?.(msg);
      throw new Error(msg);
    }
    const parts = candidate.content?.parts ?? [];
    // Append the model's turn to history so the next iteration has it.
    // Preserve thoughtSignature on every part — Gemini v1beta requires
    // it on functionCall parts for the conversation to continue across
    // turns. Dropping it triggers HTTP 400 "Function call is missing a
    // thought_signature in functionCall parts".
    contents.push({
      role: "model",
      parts: parts.map((p) => ({
        text: p.text,
        functionCall: p.functionCall,
        thoughtSignature: p.thoughtSignature,
      })),
    });
    const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
    if (functionCalls.length === 0) {
      // No tool calls → final text answer.
      const text = parts.map((p) => p.text ?? "").join("").trim();
      if (!text) {
        const msg = "Gemini devolvió una respuesta vacía.";
        callbacks.onError?.(msg);
        throw new Error(msg);
      }
      finalText = text;
      // Boss 2026-08-05 (Extensibility — Hook 3 + Hook 5): cross-check
      // the final prose against tool-reported totals, then apply the
      // formatting template. Both hooks are pure — same input → same
      // output when no rule fires. shortCircuited is false here; we
      // reached the LLM's natural final answer path.
      const guarded = applyHallucinationGuard(finalText, {
        toolResults,
        shortCircuited: false,
      });
      const guardedFinal =
        guarded.warnings.length > 0
          ? guarded.text + "\n\n" + guarded.warnings.join("\n")
          : guarded.text;
      finalText = applyFormattingTemplate(guardedFinal, {
        shortCircuited: false,
      });
      callbacks.onFinalAnswer?.(finalText);
      return finalText;
    }
    // Execute each function call, then append function-response parts.
    const responseParts: GeminiContent["parts"] = [];
    // Prose-injection guardrail: capture the latest totales from
    // any consultar_base_de_conocimiento call this turn. Set on
    // every match, so the most recent totales wins if the tool is
    // called multiple times in a single turn.
    let proseGuard: string | null = null;
    for (const fc of functionCalls) {
      if (signal?.aborted) throw new Error("Cancelado por el usuario.");
      callbacks.onToolCallStart?.(fc.name, fc.args);
      const result = await runTool(fc.name, fc.args, ctx, signal);
      callbacks.onToolCallEnd?.(fc.name, result);
      // Serialize the tool result for Gemini's function-response shape.
      let payload: Record<string, unknown> = result.ok
        ? { ok: true, ...result.result }
        : { ok: false, error: result.error };
      // Boss 2026-08-05 (Extensibility — Hook 2: post-tool-call-validator).
      // Pure — returns a new payload object if any rule fires;
      // otherwise the original is returned untouched. Warnings
      // appended via the `warnings` field, which the LLM sees as
      // part of the tool's function-response on its next turn.
      payload = applyPostToolValidator(fc.name, payload);
      responseParts.push({
        functionResponse: { name: fc.name, response: payload },
      });
      toolResults.push({
        tool: fc.name,
        result: result.ok ? result.result : null,
      });
      if (
        result.ok &&
        fc.name === "consultar_base_de_conocimiento" &&
        (result.result as ConsultarResultWithTotales | undefined)?.tabla?.totales
      ) {
        const totales = (result.result as { tabla: { totales: TotalesSpec } }).tabla.totales;
        proseGuard = formatTotalesForProse(totales);
      }
    }
    // Gemini v1beta (gemini-flash-latest and newer) accepts function
    // responses only as `role: "user"` with parts[].functionResponse.
    // The legacy `role: "function"` is rejected with HTTP 400
    // ("Role 'function' is not supported"). Verified 2026-07-30 with
    // Boss's AQ. token — the new format is required.
    contents.push({ role: "user", parts: responseParts });
    // Inject the prose guard (if any) as a separate user message so
    // the LLM has the exact aggregate value in scope when it writes
    // the final answer. The same instruction survives subsequent
    // tool-call turns in the conversation history.
    if (proseGuard) {
      contents.push({ role: "user", parts: [{ text: proseGuard }] });
    }
  }
  // If we exit the loop without a final answer, force one synthesis turn
  // by asking Gemini to wrap up with the gathered evidence.
  if (!finalText) {
    // Collect function-call results from any turn. We previously
    // filtered by `c.role === "function"`, but the current Gemini v1beta
    // API stores function responses under `role: "user"` (legacy
    // `"function"` role returns HTTP 400). Filter on the part shape
    // instead — robust across both old and new API formats.
    const summary = contents
      .flatMap((c) =>
        c.parts
          .filter((p) => p.functionResponse)
          .map((p) => `${p.functionResponse!.name}: ${JSON.stringify(p.functionResponse!.response).slice(0, 400)}`),
      )
      .join("\n");
    contents.push({
      role: "user",
      parts: [
        {
          text: `Concluye la respuesta al usuario en español usando la evidencia anterior. Sé conciso y cita los IDs de sección o elemento cuando los menciones.${summary ? "\n\nEvidencia:\n" + summary : ""}`,
        },
      ],
    });
    const response = await geminiComplete(
      {
        contents,
        systemInstruction: { parts: [{ text: JARVIS_SYSTEM_PROMPT }] },
      },
      signal,
    );
    const text = (response.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    finalText = text || "Lo siento, no pude generar una respuesta.";
    // Boss 2026-08-05 — Hook 3 + Hook 5 also applied on the
    // force-synthesis path (after MAX_TURNS). Same code as the
    // natural final-answer path above; kept inline to avoid an
    // extra closure inside the for-loop.
    const guarded = applyHallucinationGuard(finalText, {
      toolResults,
      shortCircuited: false,
    });
    const guardedFinal =
      guarded.warnings.length > 0
        ? guarded.text + "\n\n" + guarded.warnings.join("\n")
        : guarded.text;
    finalText = applyFormattingTemplate(guardedFinal, {
      shortCircuited: false,
    });
    callbacks.onFinalAnswer?.(finalText);
  }
  return finalText;
}
