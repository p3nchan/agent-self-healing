#!/usr/bin/env node

/**
 * promise-watchdog.mjs — Transcript-level promise and stall detection
 *
 * Reads agent conversation transcripts (JSONL format) and detects:
 *   1. Pending replies: user sent a message, agent hasn't responded
 *   2. Broken promises: agent said "I'll be right back" and went silent
 *
 * Notifications are deduplicated to prevent alert storms.
 *
 * Configuration via environment variables (see config.sh for defaults):
 *   SESSION_STORE                      Path to sessions.json
 *   SESSION_WATCHDOG_STATE             Path to dedup state file
 *   SESSION_WATCHDOG_LOG               Path to log file
 *   SESSION_WATCHDOG_DRY_RUN           1 = log only, don't send
 *   SESSION_WATCHDOG_REPLY_MINUTES     Threshold for pending reply (default: 6)
 *   SESSION_WATCHDOG_PROMISE_MINUTES   Threshold for broken promise (default: 7)
 *   SESSION_WATCHDOG_MAX_AGE_MINUTES   Ignore sessions older than this (default: 45)
 *   SESSION_WATCHDOG_REPEAT_MINUTES    Dedup cooldown (default: 20)
 *   NOTIFY_COMMAND                     Shell command to send notifications
 *   SESSION_WATCHDOG_NOW_MS            Override current time (for testing)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

// ─── Configuration ──────────────────────────────────────────────
const workspaceRoot = process.env.WORKSPACE_ROOT || path.join(os.homedir(), ".agent-workspace");
const sessionStorePath = process.env.SESSION_STORE || path.join(workspaceRoot, "sessions", "sessions.json");
const statePath = process.env.SESSION_WATCHDOG_STATE || path.join(workspaceRoot, "healing", "session-watchdog-state.json");
const logPath = process.env.SESSION_WATCHDOG_LOG || path.join(workspaceRoot, "logs", "promise-watchdog.log");
const notifyCommand = process.env.NOTIFY_COMMAND || "";
const nowMs = parseOptionalNumber(process.env.SESSION_WATCHDOG_NOW_MS) ?? Date.now();
const dryRun = isTruthy(process.env.SESSION_WATCHDOG_DRY_RUN);
const replyThresholdMs = minutes(parseOptionalNumber(process.env.SESSION_WATCHDOG_REPLY_MINUTES) ?? 6);
const promiseThresholdMs = minutes(parseOptionalNumber(process.env.SESSION_WATCHDOG_PROMISE_MINUTES) ?? 7);
const maxAgeMs = minutes(parseOptionalNumber(process.env.SESSION_WATCHDOG_MAX_AGE_MINUTES) ?? 45);
const repeatMs = minutes(parseOptionalNumber(process.env.SESSION_WATCHDOG_REPEAT_MINUTES) ?? 20);

// ─── Promise patterns ───────────────────────────────────────────
// Add patterns for your language. These cover English and Chinese.
const promisePattern = new RegExp([
  // English
  "I(?:'ll| will) (?:be back|reply|send|post|follow up)",
  "give me \\d+ minutes?",
  "be right back",
  "let me (?:check|pull|look|find|grab|get)",
  "one moment",
  "just a (?:sec|second|minute|moment)",
  "working on it",
  "brb",
  // Chinese (Traditional + Simplified)
  "再給我",
  "給我\\s*\\d+\\s*分",
  "幾分鐘",
  "稍等",
  "等我",
  "等一下",
  "我現在就去",
  "分鐘內",
  "稍後回覆",
].join("|"), "i");

// ─── Session filtering ─────────────────────────────────────────
// Override this function to match your session key format
function shouldInspectSession(sessionKey, entry) {
  const updatedAt = parseOptionalNumber(entry.updatedAt);
  if (!updatedAt || nowMs - updatedAt > maxAgeMs) return false;

  // Skip system sessions (customize these patterns for your platform)
  if (sessionKey.includes(":cron:")) return false;
  if (sessionKey.includes(":subagent:")) return false;
  if (sessionKey.includes(":heartbeat")) return false;
  if (sessionKey === "main" || sessionKey === "system") return false;

  // Must have a transcript file
  if (!entry.sessionFile || !fs.existsSync(entry.sessionFile)) return false;

  return true;
}

// ─── Main ───────────────────────────────────────────────────────
main();

function main() {
  const sessionsStore = readJsonFile(sessionStorePath, {});
  const state = readJsonFile(statePath, {});
  const entries = Object.entries(sessionsStore).filter(([, entry]) => entry && typeof entry === "object");
  const notifications = [];
  const nextState = {};

  for (const [sessionKey, entry] of entries) {
    if (!shouldInspectSession(sessionKey, entry)) continue;
    const transcript = readTranscript(entry.sessionFile);
    if (!transcript) continue;

    const decision = decideNotification({ sessionKey, entry, transcript });
    if (!decision) continue;

    const previous = state[sessionKey];
    const alreadyNotified = previous && previous.signature === decision.signature && nowMs - previous.notifiedAt < repeatMs;
    if (alreadyNotified) {
      nextState[sessionKey] = previous;
      continue;
    }

    const delivered = sendNotification(decision.message);
    notifications.push({
      sessionKey,
      reason: decision.reason,
      delivered,
    });
    nextState[sessionKey] = {
      signature: decision.signature,
      notifiedAt: nowMs,
      reason: decision.reason,
    };
  }

  // Carry forward recent non-expired state entries
  for (const [sessionKey, previous] of Object.entries(state)) {
    if (nextState[sessionKey]) continue;
    if (!previous || typeof previous !== "object") continue;
    if (nowMs - (previous.notifiedAt || 0) <= repeatMs) nextState[sessionKey] = previous;
  }

  writeJsonFile(statePath, nextState);

  const summary = notifications.length === 0
    ? "promise-watchdog: no notifications"
    : `promise-watchdog: ${notifications.length} notification(s)`;
  log(summary);
  for (const item of notifications) {
    log(`${item.delivered ? "sent" : dryRun ? "dry-run" : "failed"} ${item.reason} (${item.sessionKey})`);
  }
  console.log(summary);
}

// ─── Decision logic ─────────────────────────────────────────────
function decideNotification({ sessionKey, transcript }) {
  const relevant = summarizeTranscript(transcript);
  if (!relevant.lastAssistant && !relevant.lastUser) return null;

  // Check 1: User sent message, agent hasn't replied
  if (relevant.lastUser && (!relevant.lastAssistant || relevant.lastAssistant.ts < relevant.lastUser.ts)) {
    const ageMs = nowMs - relevant.lastUser.ts;
    if (ageMs >= replyThresholdMs) {
      return buildNotification({
        sessionKey,
        reason: "pending-reply",
        ageMs,
        subjectText: relevant.lastUser.text,
        subjectTs: relevant.lastUser.ts,
      });
    }
  }

  // Check 2: Agent made a promise and hasn't delivered
  if (relevant.lastAssistant && promisePattern.test(relevant.lastAssistant.text)) {
    const ageMs = nowMs - relevant.lastAssistant.ts;
    if (ageMs >= promiseThresholdMs) {
      return buildNotification({
        sessionKey,
        reason: "broken-promise",
        ageMs,
        subjectText: relevant.lastAssistant.text,
        subjectTs: relevant.lastAssistant.ts,
      });
    }
  }

  return null;
}

function summarizeTranscript(events) {
  const summary = { lastUser: null, lastAssistant: null };
  for (const event of events) {
    const ts = parseTimestamp(event.timestamp);
    if (!ts) continue;
    if (event.type === "message" && event.message) {
      const role = event.message.role;
      const text = extractText(event.message.content);
      if (!text) continue;
      if (role === "user") {
        summary.lastUser = { ts, text };
      } else if (role === "assistant") {
        summary.lastAssistant = { ts, text };
      }
    }
  }
  return summary;
}

function buildNotification({ sessionKey, reason, ageMs, subjectText, subjectTs }) {
  const ageMinutes = Math.max(1, Math.round(ageMs / 60000));
  const label = reason === "pending-reply" ? "Last user message" : "Last promise";
  const action = reason === "pending-reply" ? "reply" : "progress";
  const message = [
    `Agent stall detected: session ${sessionKey} has had no ${action} for ${ageMinutes} minutes.`,
    `${label}: ${truncate(subjectText, 90)}`,
  ].join("\n");
  return {
    reason,
    message,
    signature: `${reason}:${subjectTs}`,
  };
}

// ─── Notification ───────────────────────────────────────────────
function sendNotification(message) {
  if (dryRun) {
    log(`dry-run: ${message.replace(/\n/g, " | ")}`);
    return false;
  }
  if (!notifyCommand) {
    log(`no NOTIFY_COMMAND set, logging only: ${message.replace(/\n/g, " | ")}`);
    return false;
  }
  try {
    execSync(`${notifyCommand} ${JSON.stringify(message)}`, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    return true;
  } catch (error) {
    log(`send failed: ${formatError(error)}`);
    return false;
  }
}

// ─── Transcript reading ─────────────────────────────────────────
function readTranscript(sessionFile) {
  try {
    const raw = fs.readFileSync(sessionFile, "utf8");
    const events = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {}
    }
    return events;
  } catch (error) {
    log(`failed to read transcript ${sessionFile}: ${error.message}`);
    return null;
  }
}

function extractText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

// ─── Utilities ──────────────────────────────────────────────────
function truncate(text, maxLength) {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 1)}...`;
}

function formatError(error) {
  const stderr = error?.stderr ? String(error.stderr).trim() : "";
  const stdout = error?.stdout ? String(error.stdout).trim() : "";
  return stderr || stdout || error?.message || "unknown error";
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function readJsonFile(filePath, fallbackValue) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallbackValue;
  }
}

function log(message) {
  const line = `[${new Date(nowMs).toISOString()}] ${message}\n`;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, line, "utf8");
}

function minutes(value) {
  return value * 60 * 1000;
}

function parseTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isTruthy(value) {
  if (value == null) return false;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}
