import { NextResponse } from "next/server";

const REPO = "walkersutton/cyclemetry";
const FILE_PATH = "website/content/videos/videos.json";
const BASE_BRANCH = "main";
const GITHUB_API = "https://api.github.com";

function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      return u.pathname.slice(1).split(/[?&#]/)[0] || null;
    }
    if (u.hostname.endsWith("youtube.com")) {
      return u.searchParams.get("v") || null;
    }
  } catch {
    return null;
  }
  return null;
}

function ghFetch(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not configured");
  return fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

export async function POST(request) {
  const { youtubeUrl, title, author } = await request.json();

  if (!youtubeUrl || !title || !author) {
    return NextResponse.json({ error: "All fields are required." }, { status: 400 });
  }

  const trimmedTitle = title.trim();
  const trimmedAuthor = author.trim();

  if (!trimmedTitle || !trimmedAuthor) {
    return NextResponse.json({ error: "Title and author cannot be blank." }, { status: 400 });
  }

  const videoId = extractYouTubeId(youtubeUrl.trim());
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return NextResponse.json({ error: "Could not find a valid YouTube video ID in that URL." }, { status: 400 });
  }

  try {
    // Get main branch SHA
    const refRes = await ghFetch(`/repos/${REPO}/git/ref/heads/${BASE_BRANCH}`);
    if (!refRes.ok) throw new Error("Failed to get base branch ref");
    const refData = await refRes.json();
    const baseSha = refData.object.sha;

    // Get current file content + SHA
    const fileRes = await ghFetch(`/repos/${REPO}/contents/${FILE_PATH}?ref=${BASE_BRANCH}`);
    if (!fileRes.ok) throw new Error("Failed to fetch videos.json");
    const fileData = await fileRes.json();
    const fileSha = fileData.sha;
    const currentContent = JSON.parse(Buffer.from(fileData.content, "base64").toString("utf8"));

    // Check for duplicate
    if (currentContent.some((v) => v.id === videoId)) {
      return NextResponse.json({ error: "That video has already been submitted." }, { status: 409 });
    }

    const newEntry = {
      id: videoId,
      title: trimmedTitle,
      author: trimmedAuthor,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    };
    const updatedContent = [...currentContent, newEntry];
    const newFileContent = Buffer.from(JSON.stringify(updatedContent, null, 2) + "\n").toString("base64");

    // Create branch
    const branchName = `submit-video/${videoId}`;
    const branchRes = await ghFetch(`/repos/${REPO}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${branchName}`, sha: baseSha },
    });
    if (!branchRes.ok && branchRes.status !== 422) {
      throw new Error("Failed to create branch");
    }

    // Commit updated file
    const commitRes = await ghFetch(`/repos/${REPO}/contents/${FILE_PATH}`, {
      method: "PUT",
      body: {
        message: `feat: add video "${trimmedTitle}" by ${trimmedAuthor}`,
        content: newFileContent,
        sha: fileSha,
        branch: branchName,
      },
    });
    if (!commitRes.ok) throw new Error("Failed to commit file update");

    // Open PR
    const prRes = await ghFetch(`/repos/${REPO}/pulls`, {
      method: "POST",
      body: {
        title: `Add video: "${trimmedTitle}" by ${trimmedAuthor}`,
        body: `## New Video Submission\n\n| Field | Value |\n|-------|-------|\n| **Title** | ${trimmedTitle} |\n| **Author** | ${trimmedAuthor} |\n| **YouTube** | https://www.youtube.com/watch?v=${videoId} |\n| **Video ID** | \`${videoId}\` |\n\n*Submitted via cyclemetry.walkersutton.com/videos/submit*`,
        head: branchName,
        base: BASE_BRANCH,
      },
    });

    if (!prRes.ok) {
      const prErr = await prRes.json().catch(() => ({}));
      throw new Error(prErr.message || "Failed to create PR");
    }

    const prData = await prRes.json();
    return NextResponse.json({ prUrl: prData.html_url });
  } catch (err) {
    console.error("[videos/submit]", err);
    return NextResponse.json({ error: err.message || "Something went wrong. Try again or submit via GitHub." }, { status: 500 });
  }
}
