import type {
  ProjectsRevisionsData,
  ProjectsCommentsData,
  WebsimComment,
} from "websim";

import config from "#config";

import { is_jwt_expired, cookie } from "./cookie-manager";
import { processProjectRevision } from "./project-revision";

function getHeaders() {
  const headers = {
    "Content-Type": "application/json",
    cookie: cookie.get(),
  } as const;
  return headers;
}

async function fetchLatestRevisions(project_id: string) {
  const headers = getHeaders();
  const url_revisions =
    `${config.base_url}/api/v1/projects/${project_id}/revisions` as const;
  const resp = await fetch(url_revisions, { headers });

  const resp_json: unknown = await resp.clone().json();

  if (is_jwt_expired(resp_json)) {
    await cookie.refresh();
    return;
  }

  if (resp.status !== 200) {
    console.error(
      `Fetch revisions failed: ${resp.status}, Body: ${await resp.text()}`,
    );
    return;
  }

  const { revisions } = resp_json as ProjectsRevisionsData;

  const first = revisions.data[0];

  if (!first) {
    console.info("[Monitor] No revisions found");
    return;
  }

  console.info(`[Monitor] site.state = ${first.site.state}`);

  if (first.site.state !== "done") {
    console.info("[Monitor] Site not yet ready. Skipping execution.");
    return;
  }

  const owner_id = first.project_revision.created_by.id;
  return { owner_id };
}

async function fetchComments(
  project_id: string,
  { owner_id }: { owner_id: string },
) {
  const headers = getHeaders();
  const url_comments = `${config.base_url}/api/v1/projects/${project_id}/comments`;
  const resp = await fetch(url_comments, { headers });

  const resp_json: unknown = await resp.json();

  if (is_jwt_expired(resp_json)) {
    await cookie.refresh();
    return;
  }

  if (resp.status !== 200) {
    console.error(
      `Fetch comments failed: ${resp.status}, Body: ${await resp.text()}`,
    );
    return;
  }

  const {
    comments: { data: comm_data },
  } = resp_json as ProjectsCommentsData;

  let comment: WebsimComment | null = null;

  if (!comm_data.length) {
    console.info("[Monitor] No comments to process");
    return;
  }

  for (const { comment: c } of comm_data) {
    // Skip pinned comments
    if (c.pinned) continue;

    // last comment before replied
    if (
      await checkRepliesForExistingAutoResponse(project_id, {
        comment_id: c.id,
        owner_id,
      })
    ) {
      break;
    }

    comment = c;
  }

  if (comment === null) {
    console.info("[Monitor] No comments to process");
    return;
  }

  const comment_id = comment.id;
  const raw_content = comment.raw_content;
  const author = comment.author;

  console.info(
    `[Monitor] First comment by ${author.username}: "${raw_content}"`,
  );

  return { comment_id, raw_content };
}

async function checkRepliesForExistingAutoResponse(
  project_id: string,
  { comment_id, owner_id }: { comment_id: string; owner_id: string },
) {
  const url_replies = `${config.base_url}/api/v1/projects/${project_id}/comments/${comment_id}/replies`;
  const resp = await fetch(url_replies, { headers: getHeaders() });
  const resp_json: unknown = await resp.json();
  if (is_jwt_expired(resp_json)) {
    await cookie.refresh();
    return true;
  }

  if (resp.status !== 200) {
    console.error(
      `Fetch replies failed: ${resp.status}, Body: ${await resp.text()}`,
    );
    return true;
  }

  const { comments } = resp_json as ProjectsCommentsData;

  const already_replied = comments.data.some(({ comment }) => {
    return (
      comment.author.id === owner_id &&
      comment.raw_content?.includes(config.auto_response_prefix)
    );
  });

  if (already_replied) {
    console.info("[Monitor] Found auto reply headers. Skipping.");
    return true;
  }

  return false;
}

async function checkAndRespond(project_id: string) {
  try {
    console.info(`[Monitor] Checking project ${project_id}`);

    // Step 1: Fetch latest revisions
    const latestRevisions = await fetchLatestRevisions(project_id);
    if (!latestRevisions) return;
    const { owner_id } = latestRevisions;

    // Step 2: Fetch comments
    const comments = await fetchComments(project_id, { owner_id });
    if (!comments) return;
    const { comment_id, raw_content } = comments;

    // Step 3: Check replies for existing auto response
    if (
      await checkRepliesForExistingAutoResponse(project_id, {
        comment_id,
        owner_id,
      })
    ) {
      return;
    }

    // Step 4: Create new revision with safety note
    console.info("[Monitor] Creating new revision...");
    const revision = await processProjectRevision(
      project_id,
      `${raw_content}${config.additional_note}`,
      config.model_id,
    );

    console.info(
      `[Monitor] Revision created: ID=${revision.revision_id}, version=${revision.revision_version}`,
    );

    // Step 5: Post confirmation comment

    const url_comments = `${config.base_url}/api/v1/projects/${project_id}/comments`;
    await fetch(url_comments, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        content: `${config.auto_response_prefix}${config.auto_response_create_revision}`,
        parent_comment_id: comment_id,
      }),
    });

    console.info("[Monitor] Confirmation comment posted.");
  } catch (e) {
    console.error(`[Monitor] Error: ${e}`);
  }
}

async function monitorProject(project_id: string) {
  console.info(
    `[Monitor] Starting automatic monitor for project ${project_id}`,
  );

  while (true) {
    await checkAndRespond(project_id);
    await Bun.sleep(config.interval * 1000);
  }
}

monitorProject(config.project_id);
