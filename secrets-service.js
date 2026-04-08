import {
  SecretsManagerClient,
  ListSecretsCommand,
  GetSecretValueCommand,
  CreateSecretCommand,
  UpdateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const GROUPS_FILE = path.join(DATA_DIR, "groups.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Groups (local persistence) ─────────────────────────────────────────────

function loadGroups() {
  try {
    return JSON.parse(fs.readFileSync(GROUPS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveGroups(groups) {
  fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2));
}

export function getGroups() {
  return loadGroups();
}

export function createGroup(name, description = "") {
  const groups = loadGroups();
  if (groups[name]) throw new Error(`Group "${name}" already exists`);
  groups[name] = { description, secrets: [] };
  saveGroups(groups);
  return groups[name];
}

export function deleteGroup(name) {
  const groups = loadGroups();
  if (!groups[name]) throw new Error(`Group "${name}" not found`);
  delete groups[name];
  saveGroups(groups);
}

export function addSecretToGroup(groupName, secretName) {
  const groups = loadGroups();
  if (!groups[groupName]) throw new Error(`Group "${groupName}" not found`);
  if (!groups[groupName].secrets.includes(secretName)) {
    groups[groupName].secrets.push(secretName);
    saveGroups(groups);
  }
  return groups[groupName];
}

export function removeSecretFromGroup(groupName, secretName) {
  const groups = loadGroups();
  if (!groups[groupName]) throw new Error(`Group "${groupName}" not found`);
  groups[groupName].secrets = groups[groupName].secrets.filter(
    (s) => s !== secretName
  );
  saveGroups(groups);
  return groups[groupName];
}

// ── Subgroups (local persistence) ─────────────────────────────────────────

export function createSubgroup(groupName, subgroupName, description = "") {
  const groups = loadGroups();
  if (!groups[groupName]) throw new Error(`Group "${groupName}" not found`);
  if (!groups[groupName].subgroups) groups[groupName].subgroups = {};
  if (groups[groupName].subgroups[subgroupName])
    throw new Error(`Subgroup "${subgroupName}" already exists in "${groupName}"`);
  groups[groupName].subgroups[subgroupName] = { description, secrets: [] };
  saveGroups(groups);
  return groups[groupName].subgroups[subgroupName];
}

export function deleteSubgroup(groupName, subgroupName) {
  const groups = loadGroups();
  if (!groups[groupName]) throw new Error(`Group "${groupName}" not found`);
  if (!groups[groupName].subgroups?.[subgroupName])
    throw new Error(`Subgroup "${subgroupName}" not found in "${groupName}"`);
  delete groups[groupName].subgroups[subgroupName];
  saveGroups(groups);
}

export function addSecretToSubgroup(groupName, subgroupName, secretName) {
  const groups = loadGroups();
  if (!groups[groupName]) throw new Error(`Group "${groupName}" not found`);
  if (!groups[groupName].subgroups?.[subgroupName])
    throw new Error(`Subgroup "${subgroupName}" not found in "${groupName}"`);
  if (!groups[groupName].subgroups[subgroupName].secrets.includes(secretName)) {
    groups[groupName].subgroups[subgroupName].secrets.push(secretName);
    saveGroups(groups);
  }
  return groups[groupName].subgroups[subgroupName];
}

export function removeSecretFromSubgroup(groupName, subgroupName, secretName) {
  const groups = loadGroups();
  if (!groups[groupName]) throw new Error(`Group "${groupName}" not found`);
  if (!groups[groupName].subgroups?.[subgroupName])
    throw new Error(`Subgroup "${subgroupName}" not found in "${groupName}"`);
  groups[groupName].subgroups[subgroupName].secrets =
    groups[groupName].subgroups[subgroupName].secrets.filter((s) => s !== secretName);
  saveGroups(groups);
  return groups[groupName].subgroups[subgroupName];
}

// ── AWS Secrets Manager ────────────────────────────────────────────────────

function getClient(region = "ap-southeast-2") {
  return new SecretsManagerClient({ region });
}

export async function listSecrets(region, namePrefix, maxResults = 100) {
  const client = getClient(region);
  const params = { MaxResults: Math.min(maxResults, 100) };
  if (namePrefix) {
    params.Filters = [{ Key: "name", Values: [namePrefix] }];
  }
  const secrets = [];
  let nextToken;
  do {
    if (nextToken) params.NextToken = nextToken;
    const resp = await client.send(new ListSecretsCommand(params));
    for (const s of resp.SecretList || []) {
      secrets.push({
        name: s.Name,
        arn: s.ARN,
        description: s.Description || "",
        lastChanged: s.LastChangedDate?.toISOString() || "",
        tags: (s.Tags || []).reduce((o, t) => ({ ...o, [t.Key]: t.Value }), {}),
      });
      if (secrets.length >= maxResults) break;
    }
    nextToken = resp.NextToken;
  } while (nextToken && secrets.length < maxResults);
  return secrets;
}

export async function getSecretValue(secretId, region) {
  const client = getClient(region);
  const resp = await client.send(
    new GetSecretValueCommand({ SecretId: secretId })
  );
  return {
    name: resp.Name,
    arn: resp.ARN,
    secretValue: resp.SecretString || "<binary>",
    versionId: resp.VersionId,
  };
}

export async function createSecret(name, secretValue, description, region, tags) {
  const client = getClient(region);
  const params = { Name: name, SecretString: secretValue };
  if (description) params.Description = description;
  if (tags) {
    params.Tags = Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
  }
  const resp = await client.send(new CreateSecretCommand(params));
  return { arn: resp.ARN, name: resp.Name };
}

export async function updateSecret(secretId, secretValue, description, region) {
  const client = getClient(region);
  const params = { SecretId: secretId, SecretString: secretValue };
  if (description !== undefined) params.Description = description;
  const resp = await client.send(new UpdateSecretCommand(params));
  return { arn: resp.ARN, name: resp.Name, versionId: resp.VersionId };
}

export async function deleteSecret(secretId, region, forceDelete = false) {
  const client = getClient(region);
  const params = { SecretId: secretId };
  if (forceDelete) {
    params.ForceDeleteWithoutRecovery = true;
  } else {
    params.RecoveryWindowInDays = 30;
  }
  const resp = await client.send(new DeleteSecretCommand(params));
  return {
    arn: resp.ARN,
    name: resp.Name,
    deletionDate: resp.DeletionDate?.toISOString() || "",
  };
}

export async function describeSecret(secretId, region) {
  const client = getClient(region);
  const resp = await client.send(
    new DescribeSecretCommand({ SecretId: secretId })
  );
  return {
    name: resp.Name,
    arn: resp.ARN,
    description: resp.Description || "",
    rotationEnabled: resp.RotationEnabled || false,
    lastChanged: resp.LastChangedDate?.toISOString() || "",
    tags: (resp.Tags || []).reduce((o, t) => ({ ...o, [t.Key]: t.Value }), {}),
  };
}
