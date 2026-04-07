import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as svc from "./secrets-service.js";

const server = new McpServer({
  name: "secrets-manager-groups",
  version: "1.0.0",
});

// ── Group Tools ────────────────────────────────────────────────────────────

server.registerTool("list_groups", { description: "List all secret groups", inputSchema: {} }, async () => {
  return { content: [{ type: "text", text: JSON.stringify(svc.getGroups(), null, 2) }] };
});

server.registerTool(
  "create_group",
  { description: "Create a new group for organizing secrets", inputSchema: { name: z.string(), description: z.string().optional().default("") } },
  async ({ name, description }) => {
    const group = svc.createGroup(name, description);
    return { content: [{ type: "text", text: JSON.stringify(group, null, 2) }] };
  }
);

server.registerTool(
  "delete_group",
  { description: "Delete a secret group", inputSchema: { name: z.string() } },
  async ({ name }) => {
    svc.deleteGroup(name);
    return { content: [{ type: "text", text: `Group "${name}" deleted` }] };
  }
);

server.registerTool(
  "add_secret_to_group",
  { description: "Add a secret to a group", inputSchema: { group_name: z.string(), secret_name: z.string() } },
  async ({ group_name, secret_name }) => {
    const group = svc.addSecretToGroup(group_name, secret_name);
    return { content: [{ type: "text", text: JSON.stringify(group, null, 2) }] };
  }
);

server.registerTool(
  "remove_secret_from_group",
  { description: "Remove a secret from a group", inputSchema: { group_name: z.string(), secret_name: z.string() } },
  async ({ group_name, secret_name }) => {
    const group = svc.removeSecretFromGroup(group_name, secret_name);
    return { content: [{ type: "text", text: JSON.stringify(group, null, 2) }] };
  }
);

// ── Subgroup Tools ─────────────────────────────────────────────────────────

server.registerTool(
  "create_subgroup",
  { description: "Create a subgroup within a group", inputSchema: { group_name: z.string(), subgroup_name: z.string(), description: z.string().optional().default("") } },
  async ({ group_name, subgroup_name, description }) => {
    const sub = svc.createSubgroup(group_name, subgroup_name, description);
    return { content: [{ type: "text", text: JSON.stringify(sub, null, 2) }] };
  }
);

server.registerTool(
  "delete_subgroup",
  { description: "Delete a subgroup from a group", inputSchema: { group_name: z.string(), subgroup_name: z.string() } },
  async ({ group_name, subgroup_name }) => {
    svc.deleteSubgroup(group_name, subgroup_name);
    return { content: [{ type: "text", text: `Subgroup "${subgroup_name}" deleted from "${group_name}"` }] };
  }
);

server.registerTool(
  "add_secret_to_subgroup",
  { description: "Add a secret to a subgroup", inputSchema: { group_name: z.string(), subgroup_name: z.string(), secret_name: z.string() } },
  async ({ group_name, subgroup_name, secret_name }) => {
    const sub = svc.addSecretToSubgroup(group_name, subgroup_name, secret_name);
    return { content: [{ type: "text", text: JSON.stringify(sub, null, 2) }] };
  }
);

server.registerTool(
  "remove_secret_from_subgroup",
  { description: "Remove a secret from a subgroup", inputSchema: { group_name: z.string(), subgroup_name: z.string(), secret_name: z.string() } },
  async ({ group_name, subgroup_name, secret_name }) => {
    const sub = svc.removeSecretFromSubgroup(group_name, subgroup_name, secret_name);
    return { content: [{ type: "text", text: JSON.stringify(sub, null, 2) }] };
  }
);

// ── AWS Secret Tools ───────────────────────────────────────────────────────

server.registerTool(
  "list_secrets",
  {
    description: "List secrets from AWS Secrets Manager",
    inputSchema: {
      region: z.string().optional().default("ap-southeast-2"),
      prefix: z.string().optional(),
      max_results: z.number().optional().default(100),
    },
  },
  async ({ region, prefix, max_results }) => {
    const secrets = await svc.listSecrets(region, prefix, max_results);
    return { content: [{ type: "text", text: JSON.stringify(secrets, null, 2) }] };
  }
);

server.registerTool(
  "get_secret_value",
  {
    description: "Get the value of a secret",
    inputSchema: {
      secret_id: z.string(),
      region: z.string().optional().default("ap-southeast-2"),
    },
  },
  async ({ secret_id, region }) => {
    const data = await svc.getSecretValue(secret_id, region);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.registerTool(
  "create_secret",
  {
    description: "Create a new secret in AWS Secrets Manager",
    inputSchema: {
      name: z.string(),
      secret_value: z.string(),
      description: z.string().optional().default(""),
      region: z.string().optional().default("ap-southeast-2"),
    },
  },
  async ({ name, secret_value, description, region }) => {
    const data = await svc.createSecret(name, secret_value, description, region);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.registerTool(
  "update_secret",
  {
    description: "Update an existing secret's value",
    inputSchema: {
      secret_id: z.string(),
      secret_value: z.string(),
      description: z.string().optional(),
      region: z.string().optional().default("ap-southeast-2"),
    },
  },
  async ({ secret_id, secret_value, description, region }) => {
    const data = await svc.updateSecret(secret_id, secret_value, description, region);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.registerTool(
  "delete_secret",
  {
    description: "Delete a secret from AWS Secrets Manager",
    inputSchema: {
      secret_id: z.string(),
      region: z.string().optional().default("ap-southeast-2"),
      force: z.boolean().optional().default(false),
    },
  },
  async ({ secret_id, region, force }) => {
    const data = await svc.deleteSecret(secret_id, region, force);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Start ──────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
