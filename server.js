import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import * as svc from "./secrets-service.js";

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

// ── AI Chat ────────────────────────────────────────────────────────────────

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

app.post("/api/chat", async (req, res) => {
  const { message, region = "ap-southeast-2" } = req.body;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders(); // send headers immediately so browser starts reading

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (res.flush) res.flush(); // flush if compression middleware is present
  };

  const groups = svc.getGroups();
  const groupSummary = Object.entries(groups).map(([name, g]) => ({
    name,
    secrets: g.secrets,
    subgroups: Object.keys(g.subgroups || {}),
  }));

  const tools = [
    {
      name: "get_group_secrets",
      description: "Get all secret names in a group (or subgroup)",
      input_schema: {
        type: "object",
        properties: {
          group_name: { type: "string" },
          subgroup_name: { type: "string", description: "Optional subgroup name" },
        },
        required: ["group_name"],
      },
    },
    {
      name: "get_secret_value",
      description: "Get the current JSON value of a secret from AWS",
      input_schema: {
        type: "object",
        properties: { secret_name: { type: "string" } },
        required: ["secret_name"],
      },
    },
    {
      name: "update_secret_value",
      description: "Update a secret's JSON key-value pairs in AWS Secrets Manager",
      input_schema: {
        type: "object",
        properties: {
          secret_name: { type: "string" },
          new_value: { type: "object", description: "Complete JSON object to store" },
        },
        required: ["secret_name", "new_value"],
      },
    },
  ];

  const system = `You are a strictly scoped assistant for AWS Secrets Manager. Your ONLY allowed operations are:
- Add a key=value to secrets in a group
- Update an existing key's value in secrets in a group
- Remove a key from secrets in a group

Available groups: ${JSON.stringify(groupSummary, null, 2)}

STRICT RULES — you must follow these without exception:
1. REFUSE any request that is not about adding, updating, or removing a key-value variable in a secrets group. This includes: general questions, coding help, explanations, anything unrelated to secret variable management.
2. NEVER read or expose the full contents of a secret to the user. Never print or summarize secret values.
3. NEVER delete an entire secret, only individual keys within a secret's JSON.
4. Only operate on groups that exist in the list above.
5. If the request is out of scope, reply with exactly: "I can only help with adding, updating, or removing variables in your secrets groups."

When a valid request is made:
1. Call get_group_secrets to list secrets in the target group
2. For each secret, call get_secret_value to get its current JSON
3. Apply only the requested change (add/update/delete the specific key), leave all other keys unchanged
4. Call update_secret_value with the full modified object
5. Confirm what was done (secret names updated, key changed) — do NOT show values`;

  const messages = [{ role: "user", content: message }];

  try {
    while (true) {
      const response = await anthropic.messages.create({
        model: "claude-opus-4-6",
        max_tokens: 4096,
        system,
        tools,
        messages,
      });

      for (const block of response.content) {
        if (block.type === "text" && block.text) {
          send({ type: "text", text: block.text });
        }
      }

      if (response.stop_reason === "end_turn") break;

      if (response.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content: response.content });
        const toolResults = [];

        for (const block of response.content) {
          if (block.type !== "tool_use") continue;

          send({ type: "tool_call", tool: block.name, input: block.input });

          let result;
          try {
            if (block.name === "get_group_secrets") {
              const g = groups[block.input.group_name];
              if (!g) throw new Error(`Group "${block.input.group_name}" not found`);
              const secrets = block.input.subgroup_name
                ? (g.subgroups?.[block.input.subgroup_name]?.secrets || [])
                : (g.secrets || []);
              result = { secrets };
            } else if (block.name === "get_secret_value") {
              const val = await svc.getSecretValue(block.input.secret_name, region);
              try { result = { value: JSON.parse(val.secretValue) }; }
              catch { result = { value: val.secretValue }; }
            } else if (block.name === "update_secret_value") {
              await svc.updateSecret(
                block.input.secret_name,
                JSON.stringify(block.input.new_value),
                undefined,
                region
              );
              result = { success: true };
              send({ type: "updated", secret: block.input.secret_name });
            }
          } catch (e) {
            result = { error: e.message };
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }

        messages.push({ role: "user", content: toolResults });
      }
    }
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
