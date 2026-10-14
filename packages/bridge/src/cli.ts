#!/usr/bin/env node
import { stdin } from "node:process";
import { createDshCompanionBridge } from "./bridge.js";
import { LinkoBridgeError } from "./client.js";
import type { BridgeToolName } from "./types.js";

const COMMANDS: readonly BridgeToolName[] = ["ask", "inbox", "inspect", "draft", "approve", "reply"];

function usage(): string {
  return [
    "Usage: linko-dsh <ask|inbox|inspect|draft|approve|reply> [--base-url URL] [JSON]",
    "JSON may be passed as the final argument or through stdin.",
    "The default base URL is http://127.0.0.1:8787.",
  ].join("\n");
}

async function readStdin(): Promise<string> {
  if (stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

function jsonArg(raw: string | undefined, command: BridgeToolName): unknown {
  if (raw === undefined || raw.length === 0) {
    if (command === "inbox") return {};
    throw new Error(`${command} requires a JSON input object`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("input must be valid JSON");
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) { console.log(usage()); return; }
  const command = args.shift();
  if (!COMMANDS.includes(command as BridgeToolName)) throw new Error(usage());
  const selected = command as BridgeToolName;
  let baseUrl = process.env.LINKO_LOCAL_URL ?? "http://127.0.0.1:8787";
  const remaining: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base-url") {
      const value = args[++index];
      if (value === undefined) throw new Error("--base-url requires a URL");
      baseUrl = value;
    } else if (arg === "--json") {
      const value = args[++index];
      if (value === undefined) throw new Error("--json requires a JSON value");
      remaining.push(value);
    } else remaining.push(arg);
  }
  let raw = remaining.length > 0 ? remaining.join(" ") : await readStdin();
  if (selected === "inspect" && remaining.length === 1 && !raw.trim().startsWith("{")) raw = JSON.stringify({ eventId: raw.trim() });
  const input = jsonArg(raw, selected);
  const bridge = createDshCompanionBridge({ baseUrl });
  let result: unknown;
  if (selected === "ask") result = await bridge.ask(input as Parameters<typeof bridge.ask>[0]);
  else if (selected === "inbox") result = await bridge.inbox(input as Parameters<typeof bridge.inbox>[0]);
  else if (selected === "inspect") {
    const value = input as { eventId?: unknown };
    result = await bridge.inspect(typeof value === "string" ? value : String(value.eventId ?? ""));
  } else if (selected === "draft") result = await bridge.draft(input as Parameters<typeof bridge.draft>[0]);
  else if (selected === "approve") result = await bridge.approve(input as Parameters<typeof bridge.approve>[0]);
  else result = await bridge.reply(input as Parameters<typeof bridge.reply>[0]);
  console.log(JSON.stringify(result));
}

main().catch((error: unknown) => {
  const payload = error instanceof LinkoBridgeError
    ? { error: { code: error.code, message: error.message, status: error.status, ...(error.detail === undefined ? {} : { detail: error.detail }) } }
    : { error: { code: "CLI_ERROR", message: error instanceof Error ? error.message : "bridge command failed" } };
  console.error(JSON.stringify(payload));
  process.exitCode = 1;
});
