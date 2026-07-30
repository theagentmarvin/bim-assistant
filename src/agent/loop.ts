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

const MAX_TURNS = 6; // bumped 4→6 because RAG-before-filter (consultar_base_de_conocimiento → resaltar_elementos) consumes 2 turns

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
): Promise<string> {
  const contents: GeminiContent[] = [
    {
      role: "user",
      parts: [{ text: userMessage }],
    },
  ];
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
    contents.push({
      role: "model",
      parts: parts.map((p) => ({
        text: p.text,
        functionCall: p.functionCall,
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
      callbacks.onFinalAnswer?.(text);
      return text;
    }
    // Execute each function call, then append function-response parts.
    const responseParts: GeminiContent["parts"] = [];
    for (const fc of functionCalls) {
      if (signal?.aborted) throw new Error("Cancelado por el usuario.");
      callbacks.onToolCallStart?.(fc.name, fc.args);
      const result = await runTool(fc.name, fc.args, ctx, signal);
      callbacks.onToolCallEnd?.(fc.name, result);
      // Serialize the tool result for Gemini's function-response shape.
      const payload = result.ok
        ? { ok: true, ...result.result }
        : { ok: false, error: result.error };
      responseParts.push({
        functionResponse: { name: fc.name, response: payload },
      });
    }
    contents.push({ role: "function", parts: responseParts });
  }
  // If we exit the loop without a final answer, force one synthesis turn
  // by asking Gemini to wrap up with the gathered evidence.
  if (!finalText) {
    const summary = contents
      .filter((c) => c.role === "function")
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
    callbacks.onFinalAnswer?.(finalText);
  }
  return finalText;
}
