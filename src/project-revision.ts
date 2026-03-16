import type { ProjectData, ProjectsRevisionData } from "websim";

import config from "#config";

import { cookie } from "./cookie-manager";

/**
 * Generates a random alphanumeric site ID of given length.
 */
function generateSiteId(length: number = 17): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}

/**
 * Custom error for project revision failures.
 */
class ProjectRevisionError extends Error {
  override readonly name = "ProjectRevisionError";
}

async function fetchCurrentProjectInfo({
  project_id,
  headers,
}: {
  project_id: string;
  headers: HeadersInit;
}) {
  const url_proj = `${config.base_url}/api/v1/projects/${project_id}`;
  const resp = await fetch(url_proj, { headers });

  if (resp.status !== 200) {
    const body = await resp.text();
    const msg = `[ProjectRevision] Failed to fetch project info: ${resp.status}, Response: ${body}`;
    console.error(msg);
    throw new ProjectRevisionError(msg);
  }

  const { project_revision }: ProjectData = await resp.json();
  const parent_version = project_revision!.version;
  console.info(`[ProjectRevision] Current project version: ${parent_version}`);
  return { parent_version };
}

async function createNewRevision(
  { project_id, headers }: { project_id: string; headers: HeadersInit },
  { parent_version }: { parent_version: number },
) {
  const url_revisions = `${config.base_url}/api/v1/projects/${project_id}/revisions`;
  const payload = { parent_version };

  const resp = await fetch(url_revisions, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (resp.status !== 201) {
    const body = await resp.text();
    const msg = `[ProjectRevision] Failed to create revision: ${resp.status}, Response: ${body}`;
    console.error(msg);
    throw new ProjectRevisionError(msg);
  }

  const { project_revision }: ProjectsRevisionData = await resp.json();
  const revision_id = project_revision.id;
  const revision_version = project_revision.version;
  console.info(
    `[ProjectRevision] Created revision ID: ${revision_id}, Version: ${revision_version}`,
  );
  return { revision_id, revision_version };
}

async function createDraftSite(
  { project_id, headers }: { project_id: string; headers: HeadersInit },
  {
    prompt,
    model_id,
    revision_version,
    revision_id,
  }: {
    prompt: string;
    model_id: string;
    revision_version: number;
    revision_id: string;
  },
) {
  const site_id = generateSiteId();
  console.info(`[ProjectRevision] Generated site ID: ${site_id}`);
  const url_site = `${config.base_url}/api/v1/sites`;

  // # Extra Step: Enable optional features
  const enableMultiplayer = prompt.toLowerCase().includes("multiplayer");
  const enableDB =
    prompt.toLowerCase().includes("database") ||
    prompt.toLowerCase().includes("db");

  // # Construct Final Payload
  const payload = {
    generate: {
      prompt: { type: "plaintext", text: prompt, data: null },
      flags: { use_worker_generation: false },
      model: model_id,
      lore: {
        version: 1,
        attachments: [],
        references: [],
        enableDatabase: false,
        enableApi: true,
        enableMultiplayer,
        enableMobilePrompt: true,
        enableDB,
        enableLLM: false,
        enableLLM2: true,
        enableTweaks: false,
        features: {
          context: true,
          errors: true,
          htmx: true,
          images: true,
          navigation: true,
        },
      },
    },
    project_id,
    project_version: revision_version,
    project_revision_id: revision_id,
    site_id,
  };

  const resp = await fetch(url_site, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (resp.status !== 201) {
    const body = await resp.text();
    const msg = `[ProjectRevision] Failed to create site: ${resp.status}, Response: ${body}`;
    console.error(msg);
    throw new ProjectRevisionError(msg);
  }

  console.info("[ProjectRevision] Created draft site successfully");
  return { site_id };
}

async function confirmDraft(
  { project_id, headers }: { project_id: string; headers: HeadersInit },
  { revision_version }: { revision_version: number },
) {
  const url_confirm = `${config.base_url}/api/v1/projects/${project_id}/revisions/${revision_version}`;

  const payload = { draft: false };

  const resp = await fetch(url_confirm, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });

  if (resp.status !== 200) {
    const body = await resp.text();
    const msg = `[ProjectRevision] Failed to confirm draft: ${resp.status}, Response: ${body}`;
    console.error(msg);
    throw new ProjectRevisionError(msg);
  }

  console.info("[ProjectRevision] Confirmed draft successfully");
}

async function updateProjectCurrentVersion(
  { project_id, headers }: { project_id: string; headers: HeadersInit },
  { revision_version }: { revision_version: number },
) {
  const url_update = `${config.base_url}/api/v1/projects/${project_id}`;

  const payload = { current_version: revision_version };

  const resp = await fetch(url_update, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });

  if (resp.status !== 200) {
    const body = await resp.text();
    const msg = `[ProjectRevision] Failed to update current version: ${resp.status}, Response: ${body}`;
    console.error(msg);
    throw new ProjectRevisionError(msg);
  }

  console.info(
    `[ProjectRevision] Updated project current version to: ${revision_version}`,
  );
}

export async function processProjectRevision(
  project_id: string,
  prompt: string,
  model_id: string,
) {
  const headers = {
    "Content-Type": "application/json",
    cookie: cookie.get(),
  } as const;

  // # 1) Fetch current project info
  const { parent_version } = await fetchCurrentProjectInfo({
    project_id,
    headers,
  });

  // # 2) Create new revision
  const { revision_id, revision_version } = await createNewRevision(
    { project_id, headers },
    { parent_version },
  );

  // # 3) Create draft site
  const { site_id } = await createDraftSite(
    { project_id, headers },
    { prompt, model_id, revision_version, revision_id },
  );

  // # 4) Confirm draft
  await confirmDraft({ project_id, headers }, { revision_version });

  // # 5) Update project current version
  await updateProjectCurrentVersion(
    { project_id, headers },
    { revision_version },
  );

  return { revision_id, revision_version, site_id } as const;
}
