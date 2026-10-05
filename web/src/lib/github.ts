export interface RepoConfig { owner: string; repo: string; branch: string; token: string }

export class GitHubError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(cfg: RepoConfig, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const hint = res.status === 401 ? 'токен недействителен' : res.status === 404 ? 'репозиторий не найден или у токена нет доступа' : res.status === 403 ? 'нет прав или превышен лимит запросов' : '';
    throw new GitHubError(res.status, `GitHub ${res.status}${hint ? `: ${hint}` : ''} ${text.slice(0, 120)}`.trim());
  }
  return res.json() as Promise<T>;
}

export interface Head { commit: string; tree: string }
export interface TreeEntry { path: string; sha: string; type: string; size?: number }

export async function getHead(cfg: RepoConfig): Promise<Head> {
  const ref = await call<{ object: { sha: string } }>(cfg, `/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
  const commit = await call<{ tree: { sha: string } }>(cfg, `/git/commits/${ref.object.sha}`);
  return { commit: ref.object.sha, tree: commit.tree.sha };
}

export async function getTree(cfg: RepoConfig, treeSha: string): Promise<TreeEntry[]> {
  const res = await call<{ tree: TreeEntry[]; truncated: boolean }>(cfg, `/git/trees/${treeSha}?recursive=1`);
  if (res.truncated) throw new Error('Репозиторий слишком большой для одного запроса дерева');
  return res.tree.filter((e) => e.type === 'blob');
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function getBlob(cfg: RepoConfig, sha: string): Promise<Uint8Array> {
  const res = await call<{ content: string }>(cfg, `/git/blobs/${sha}`);
  return decodeBase64(res.content);
}

export async function getTextBlob(cfg: RepoConfig, sha: string): Promise<string> {
  return new TextDecoder().decode(await getBlob(cfg, sha));
}

export async function createBlob(cfg: RepoConfig, text: string): Promise<string> {
  return (await call<{ sha: string }>(cfg, '/git/blobs', { method: 'POST', body: JSON.stringify({ content: text, encoding: 'utf-8' }) })).sha;
}

export async function createTree(cfg: RepoConfig, baseTree: string, entries: { path: string; sha: string }[]): Promise<string> {
  const tree = entries.map((e) => ({ path: e.path, mode: '100644', type: 'blob', sha: e.sha }));
  return (await call<{ sha: string }>(cfg, '/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree }) })).sha;
}

export async function createCommit(cfg: RepoConfig, message: string, tree: string, parent: string): Promise<string> {
  return (await call<{ sha: string }>(cfg, '/git/commits', { method: 'POST', body: JSON.stringify({ message, tree, parents: [parent] }) })).sha;
}

export async function updateRef(cfg: RepoConfig, sha: string): Promise<void> {
  await call(cfg, `/git/refs/heads/${encodeURIComponent(cfg.branch)}`, { method: 'PATCH', body: JSON.stringify({ sha, force: false }) });
}

export async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// One GraphQL request returns up to 100 blob texts; the REST API needs a request per blob.
export async function getTextBlobs(cfg: RepoConfig, shas: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < shas.length; i += 100) {
    const chunk = shas.slice(i, i + 100);
    const fields = chunk.map((sha, j) => `b${j}: object(oid: "${sha}") { ... on Blob { text isTruncated } }`).join('\n');
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `query($o: String!, $r: String!) { repository(owner: $o, name: $r) { ${fields} } }`, variables: { o: cfg.owner, r: cfg.repo } }),
    });
    const data = await res.json().catch(() => ({}));
    const repo = data?.data?.repository;
    if (!res.ok || !repo) throw new GitHubError(res.status, `GitHub GraphQL: ${data?.errors?.[0]?.message ?? res.statusText}`);
    chunk.forEach((sha, j) => {
      const blob = repo[`b${j}`];
      if (blob && !blob.isTruncated && typeof blob.text === 'string') out.set(sha, blob.text);
    });
  }
  return out;
}
