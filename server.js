import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import * as svc from "./secrets-service.js";
import * as bak from "./backup-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Secrets CRUD ───────────────────────────────────────────────────────────

app.get("/api/secrets", async (req, res) => {
  try {
    const { region, prefix, max } = req.query;
    const secrets = await svc.listSecrets(region, prefix, max ? +max : 100);
    res.json(secrets);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/secrets/:name/value", async (req, res) => {
  try {
    const data = await svc.getSecretValue(req.params.name, req.query.region);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/secrets/:name/describe", async (req, res) => {
  try {
    const data = await svc.describeSecret(req.params.name, req.query.region);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/secrets", async (req, res) => {
  try {
    const { name, secretValue, description, region, tags } = req.body;
    const data = await svc.createSecret(name, secretValue, description, region, tags);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/secrets/:name", async (req, res) => {
  try {
    const { secretValue, description, region } = req.body;
    const current = await svc.getSecretValue(req.params.name, region);
    bak.backupSecret(req.params.name, current.secretValue, "ui");
    const data = await svc.updateSecret(req.params.name, secretValue, description, region);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/secrets/:name", async (req, res) => {
  try {
    const { region, force } = req.query;
    const data = await svc.deleteSecret(req.params.name, region, force === "true");
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Groups ─────────────────────────────────────────────────────────────────

app.get("/api/groups", (_req, res) => {
  res.json(svc.getGroups());
});

app.post("/api/groups", (req, res) => {
  try {
    const { name, description } = req.body;
    res.json(svc.createGroup(name, description));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/groups/:name", (req, res) => {
  try {
    svc.deleteGroup(req.params.name);
    res.json({ status: "deleted" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/groups/:name/secrets", (req, res) => {
  try {
    const data = svc.addSecretToGroup(req.params.name, req.body.secretName);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/groups/:name/secrets/:secretName", (req, res) => {
  try {
    const data = svc.removeSecretFromGroup(req.params.name, req.params.secretName);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Subgroups ──────────────────────────────────────────────────────────────

app.post("/api/groups/:name/subgroups", (req, res) => {
  try {
    const { subgroupName, description } = req.body;
    res.json(svc.createSubgroup(req.params.name, subgroupName, description));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/groups/:name/subgroups/:subName", (req, res) => {
  try {
    svc.deleteSubgroup(req.params.name, req.params.subName);
    res.json({ status: "deleted" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/groups/:name/subgroups/:subName/secrets", (req, res) => {
  try {
    const data = svc.addSecretToSubgroup(req.params.name, req.params.subName, req.body.secretName);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/groups/:name/subgroups/:subName/secrets/:secretName", (req, res) => {
  try {
    const data = svc.removeSecretFromSubgroup(req.params.name, req.params.subName, req.params.secretName);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Backups ────────────────────────────────────────────────────────────────

app.get("/api/backups", (_req, res) => {
  res.json(bak.listBackups());
});

app.get("/api/backups/:date/:file", (req, res) => {
  try {
    res.json(bak.readBackup(req.params.date, req.params.file));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── AI Chat ────────────────────────────────────────────────────────────────

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

app.post("/api/chat", async (req, res) => {
  const { message, region = "ap-southeast-2", history = [] } = req.body;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders(); // send headers immediately so browser starts reading

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (res.flush) res.flush(); // flush if compression middleware is present
  };

  const groups = svc.getGroups();
  const groupNames = Object.keys(groups);

  try {
    // ── Step 1: parse intent with a single Claude call ──────────────────────
    const parseRes = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      system: `You extract secret management operations from natural language. Use the full conversation history to resolve incomplete messages.
Available groups: ${groupNames.join(", ")}.

Output ONLY raw JSON, no markdown, no code fences, no explanation.

A target can be:
- A GROUP name (from the available groups list above) — affects all secrets in that group
- A specific SECRET NAME — a domain-like string containing dots (e.g. "trackos-api.dev.portpro.io", "transaction.legalremit.com")

Schema — supports multiple key/value pairs:
{"valid":true,"action":"add"|"update"|"remove","entries":[{"key":"K","value":"V_OR_NULL"}],"group":"GROUP_OR_NULL","subgroup":"SUBGROUP_OR_NULL","secret":"SECRET_NAME_OR_NULL"}

Examples:
"add gemini=true to ai-agents" → {"valid":true,"action":"add","entries":[{"key":"gemini","value":"true"}],"group":"ai-agents","subgroup":null,"secret":null}
"add A=1 B=2 C=3 in transaction.legalremit.com" → {"valid":true,"action":"add","entries":[{"key":"A","value":"1"},{"key":"B","value":"2"},{"key":"C","value":"3"}],"group":null,"subgroup":null,"secret":"transaction.legalremit.com"}
"remove DEBUG from production" → {"valid":true,"action":"remove","entries":[{"key":"DEBUG","value":null}],"group":"production","subgroup":null,"secret":null}
"what is the weather" → {"valid":false}

Rules:
- Use conversation history to fill in missing parts (e.g. if user said key=value before and now says the target, combine them).
- Any string with dots that is NOT in the groups list is a secret name, not a group.
- "add"/"set" → "add". "remove"/"delete" → "remove". "update"/"change" → "update".`,
      messages: [...history, { role: "user", content: message }],
    });

    let intent;
    const rawParse = parseRes.content[0].text.trim()
      .replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
    console.log("[chat] parse →", rawParse);
    try {
      // Model sometimes returns multiple JSON objects — merge into one with entries[]
      const jsonObjects = rawParse
        .split(/\n(?=\{)/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => JSON.parse(s));

      if (jsonObjects.length > 1 && jsonObjects.every(o => o.valid)) {
        // Merge: same action/target, combine entries
        const first = jsonObjects[0];
        intent = {
          valid: true,
          action: first.action,
          group: first.group,
          subgroup: first.subgroup,
          secret: first.secret,
          entries: jsonObjects.map(o => ({ key: o.entries?.[0]?.key ?? o.key, value: o.entries?.[0]?.value ?? o.value })),
        };
      } else {
        intent = jsonObjects[0] ?? { valid: false };
      }
    } catch {
      intent = { valid: false };
    }

    if (!intent.valid) {
      // Ask Claude to generate a helpful follow-up question
      const clarifyRes = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 128,
        system: `You are a secrets manager assistant. Available groups: ${groupNames.join(", ")}.
Secrets can also be targeted directly by their name (e.g. domain names like "transaction.legalremit.com").
The user's request is incomplete. Ask ONE short question to get the missing info (target secret/group name, key, or value).
If completely unrelated to secret management, reply: "I can only help with adding, updating, or removing variables in your secrets groups."`,
        messages: [...history, { role: "user", content: message }],
      });
      send({ type: "text", text: clarifyRes.content[0].text.trim() });
      send({ type: "done" });
      res.end();
      return;
    }

    let secrets = [];

    if (intent.secret) {
      // Target is a specific secret by name
      secrets = [intent.secret];
    } else {
      // Target is a group (or subgroup)
      if (intent.group) {
        intent.group = intent.group.replace(/\s*(group|secrets?)$/i, "").trim();
      }
      let group = groups[intent.group];
      if (!group) {
        const fuzzy = groupNames.find(n => n.toLowerCase() === intent.group?.toLowerCase());
        if (fuzzy) { intent.group = fuzzy; group = groups[fuzzy]; }
      }
      if (!group) {
        send({ type: "error", text: `Group "${intent.group}" not found. Available: ${groupNames.join(", ")}` });
        send({ type: "done" });
        res.end();
        return;
      }
      secrets = intent.subgroup
        ? (group.subgroups?.[intent.subgroup]?.secrets || [])
        : (group.secrets || []);
    }

    if (secrets.length === 0) {
      send({ type: "text", text: `No secrets found for the specified target.` });
      send({ type: "done" });
      res.end();
      return;
    }

    // ── Step 2: execute directly in code — no LLM loop needed ───────────────
    const entries = Array.isArray(intent.entries) ? intent.entries : [];
    let updated = 0;
    for (const secretName of secrets) {
      send({ type: "tool_call", tool: "get_secret_value", input: { secret_name: secretName } });
      try {
        const val = await svc.getSecretValue(secretName, region);
        let obj = {};
        try { obj = JSON.parse(val.secretValue); } catch { obj = {}; }

        for (const { key, value } of entries) {
          if (intent.action === "remove") {
            delete obj[key];
          } else {
            obj[key] = value;
          }
        }

        bak.backupSecret(secretName, val.secretValue, "chat");
        send({ type: "tool_call", tool: "update_secret_value", input: { secret_name: secretName } });
        await svc.updateSecret(secretName, JSON.stringify(obj), undefined, region);
        send({ type: "updated", secret: secretName });
        updated++;
      } catch (e) {
        send({ type: "error", text: `${secretName}: ${e.message}` });
      }
    }

    const verb = intent.action === "remove" ? "removed" : "set";
    const keys = entries.map(e => intent.action === "remove" ? e.key : `${e.key}=${e.value}`).join(", ");
    const target = intent.secret || `${intent.group}${intent.subgroup ? "/" + intent.subgroup : ""}`;
    send({ type: "text", text: `Done — ${verb} ${keys} in ${updated} of ${secrets.length} secret(s) in ${target}.` });

  } catch (e) {
    send({ type: "error", text: e.message });
  }

  send({ type: "done" });
  res.end();
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`Secrets Manager UI running at http://localhost:${PORT}`);
});
