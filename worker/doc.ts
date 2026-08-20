/**
 * The synced document: read it, replace it, delete it.
 *
 * There is no merge. Concurrent edits on two machines are rare in the real use
 * case — a teacher finishes at school and continues at home — and a merge
 * engine that is wrong once is worse than no merge engine at all. Instead the
 * write is conditional on the revision the client last saw: if the other device
 * got there first the write is refused, the server's copy comes back with the
 * 409, and the client puts the local version into its existing version history
 * before adopting the server's. Nothing is silently overwritten and nothing is
 * lost — the teacher picks, with both copies in front of them.
 */
import type { Env } from './lib';
import { MAX_DOC_BYTES, currentUser, json, sameOrigin } from './lib';

export async function handleDoc(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/doc') return null;

  const user = await currentUser(request, env);
  if (!user) return json({ error: 'signed_out' }, 401);

  switch (request.method) {
    case 'GET':
      return get(env, user.id);
    case 'PUT':
      return put(request, env, user.id);
    case 'DELETE':
      return remove(request, env, user.id);
    default:
      return json({ error: 'method_not_allowed' }, 405);
  }
}

async function get(env: Env, userId: string): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT doc, rev, updated_at, device FROM documents WHERE user_id = ?'
  )
    .bind(userId)
    .first<{ doc: string; rev: number; updated_at: number; device: string | null }>();
  // 204: signed in, but this account has never synced. Distinct from an empty
  // document, which the client must not mistake for "your classes were deleted".
  if (!row) return new Response(null, { status: 204 });
  return json({ rev: row.rev, updatedAt: row.updated_at, device: row.device, doc: JSON.parse(row.doc) });
}

async function put(request: Request, env: Env, userId: string): Promise<Response> {
  if (!sameOrigin(request, env)) return json({ error: 'forbidden' }, 403);

  // Absent If-Match means "this client has never synced"; it may only create.
  const header = request.headers.get('if-match');
  const baseRev = header === null ? 0 : Number(header);
  if (!Number.isInteger(baseRev) || baseRev < 0) return json({ error: 'bad_if_match' }, 400);

  const raw = await request.text();
  if (raw.length > MAX_DOC_BYTES) return json({ error: 'too_large' }, 413);
  let body: { doc?: unknown; device?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  // Shape is checked properly on the client by parseBackup before anything is
  // applied; here it only has to be a JSON object so the column holds something
  // the GET above can parse back.
  if (!body.doc || typeof body.doc !== 'object') return json({ error: 'bad_doc' }, 400);
  const device = typeof body.device === 'string' ? body.device.slice(0, 60) : null;

  const now = Date.now();
  const serialized = JSON.stringify(body.doc);

  // One statement, so two devices racing cannot both pass the check. The WHERE
  // is the whole concurrency control: it matches only if nobody else has
  // written since this client last read.
  const updated = await env.DB.prepare(
    `UPDATE documents SET doc = ?, rev = rev + 1, updated_at = ?, device = ?
      WHERE user_id = ? AND rev = ?
      RETURNING rev`
  )
    .bind(serialized, now, device, userId, baseRev)
    .first<{ rev: number }>();
  if (updated) return json({ rev: updated.rev, updatedAt: now });

  // No row updated: either nothing exists yet, or the revision moved on.
  if (baseRev === 0) {
    const inserted = await env.DB.prepare(
      `INSERT INTO documents (user_id, doc, rev, updated_at, device) VALUES (?, ?, 1, ?, ?)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING rev`
    )
      .bind(userId, serialized, now, device)
      .first<{ rev: number }>();
    if (inserted) return json({ rev: inserted.rev, updatedAt: now });
  }

  const current = await env.DB.prepare(
    'SELECT doc, rev, updated_at, device FROM documents WHERE user_id = ?'
  )
    .bind(userId)
    .first<{ doc: string; rev: number; updated_at: number; device: string | null }>();
  if (!current) return json({ error: 'conflict' }, 409);
  return json(
    {
      error: 'conflict',
      rev: current.rev,
      updatedAt: current.updated_at,
      device: current.device,
      doc: JSON.parse(current.doc),
    },
    409
  );
}

async function remove(request: Request, env: Env, userId: string): Promise<Response> {
  if (!sameOrigin(request, env)) return json({ error: 'forbidden' }, 403);
  await env.DB.prepare('DELETE FROM documents WHERE user_id = ?').bind(userId).run();
  return json({ deleted: true });
}
