/**
 * Optional cloud sync.
 *
 * The rule this module is built around: **local storage stays the source of
 * truth, and nothing here runs unless the teacher signed in.** A device that
 * never signs in makes no network request from this file at all — `start()`
 * checks for a readable hint cookie the Worker sets at sign-in, and returns
 * without touching the network if it is absent.
 *
 * What it does not do is merge. Two devices editing the same class at the same
 * moment is not the real scenario; finishing at school and continuing at home
 * is. So writes are conditional on the revision this device last saw, and a
 * refused write is resolved by *keeping both*: the local document goes into the
 * version history the app already has, the server's copy is adopted, and the
 * teacher is told, with one click to put theirs back. Nothing is merged, and
 * nothing is thrown away.
 */
import { app } from './appState.svelte';
import { parseBackup } from './backup';
import { fingerprint } from './versions';
import type { PersistedState } from './types';

/** Where this device's place in the revision sequence is remembered. */
const SYNC_KEY = 'rosterowl:sync:v1';
/**
 * Readable companion to the HttpOnly session cookie, set by the Worker. Its
 * only job is to let a signed-out visitor skip asking the API anything at all:
 * no cookie, no request, no 404 on a deploy that has no Worker. Signed out is
 * therefore genuinely network-free, which is what /privacy claims.
 */
const HINT_COOKIE = 'ro_signed_in';

function hasSessionHint(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${HINT_COOKIE}=1`));
}

/** Long enough to batch a burst of edits, short enough to survive a closed lid. */
const PUSH_DEBOUNCE_MS = 2500;

export type SyncStatus =
  | 'off' // not signed in — the default, and the only state that touches no network
  | 'checking'
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'error';

interface SyncMemory {
  rev: number;
  /** Fingerprint of the document as it was last agreed with the server. */
  mark: string | null;
}

function readMemory(): SyncMemory {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SyncMemory>;
      if (typeof parsed.rev === 'number') {
        return { rev: parsed.rev, mark: typeof parsed.mark === 'string' ? parsed.mark : null };
      }
    }
  } catch {
    /* private mode, or a corrupt entry — start over rather than fail */
  }
  return { rev: 0, mark: null };
}

function writeMemory(memory: SyncMemory) {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(memory));
  } catch {
    /* nothing to do: the next sync just re-reads from rev 0 */
  }
}

/** Something a teacher will recognise in "your Chromebook saved this". */
function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'This device';
  const ua = navigator.userAgent;
  const os =
    /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'Chromebook'
    : /Macintosh/.test(ua) ? 'Mac'
    : /iPhone|iPad/.test(ua) ? 'iPad or iPhone'
    : /Android/.test(ua) ? 'Android'
    : /Linux/.test(ua) ? 'Linux'
    : 'This device';
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : null;
  return browser ? `${browser} on ${os}` : os;
}

class Sync {
  status = $state<SyncStatus>('off');
  email = $state<string | null>(null);
  lastSyncedAt = $state<number | null>(null);
  /** True once start() has settled, so the UI can avoid flashing a wrong state. */
  ready = $state(false);

  #memory: SyncMemory = { rev: 0, mark: null };
  #timer: ReturnType<typeof setTimeout> | null = null;
  #inFlight = false;
  /** An edit landed while a push was running; push again when it finishes. */
  #dirtyAgain = false;
  #started = false;

  get signedIn(): boolean {
    return this.email !== null;
  }

  /** Called once per page by app.load(). Cheap and silent when signed out. */
  async start() {
    if (this.#started || typeof window === 'undefined') return;
    this.#started = true;
    this.#reportReturnFromGoogle();
    // Nobody has ever signed in on this device: stop before touching the network.
    if (!hasSessionHint()) {
      this.status = 'off';
      this.ready = true;
      return;
    }

    this.status = 'checking';
    this.#memory = readMemory();

    let me: { signedIn: boolean; email?: string | null };
    try {
      const response = await fetch('/api/me', { credentials: 'same-origin' });
      // A stale hint, or a build with no Worker behind it. Either way: local only.
      if (!response.ok) throw new Error(String(response.status));
      me = await response.json();
    } catch {
      this.status = 'off';
      this.ready = true;
      return;
    }
    if (!me.signedIn) {
      this.status = 'off';
      this.ready = true;
      return;
    }

    this.email = me.email ?? null;
    this.status = 'idle';
    this.ready = true;
    window.addEventListener('rosterowl-persisted', () => this.#schedulePush());
    // A laptop opened at home has been asleep, not offline; re-check on wake.
    window.addEventListener('online', () => void this.pull());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.pull();
      else this.#flush();
    });
    window.addEventListener('pagehide', () => this.#flush());
    await this.pull();
  }

  /**
   * The sign-in round trip can end without a session — the teacher pressed
   * cancel on Google's screen, or took long enough that the ten-minute OAuth
   * cookie expired. The Worker sends them back with ?sync=<reason>; without
   * this they would land on the tool with no session and no explanation, which
   * reads as the button being broken.
   */
  #reportReturnFromGoogle() {
    const url = new URL(location.href);
    const reason = url.searchParams.get('sync');
    if (!reason) return;
    // Clear it first, so a refresh does not repeat the message.
    url.searchParams.delete('sync');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    if (reason === 'cancelled') {
      app.toast('Sign-in cancelled. Everything is still here on this device.', 'info');
    } else if (reason === 'expired') {
      app.toast('That sign-in took too long — try again.', 'warn');
    } else if (reason === 'failed') {
      app.toast("Couldn't finish signing in. Your classes are safe on this device.", 'warn');
    }
  }

  signIn() {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/api/auth/google/start?next=${next}`;
  }

  async signOut() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      /* the cookie may outlive this, but the local UI should still settle */
    }
    this.email = null;
    this.status = 'off';
    // Deliberately leaves localStorage alone. Signing out is "stop syncing",
    // not "delete my work" — the classes on this device stay exactly as they are.
    this.#memory = { rev: 0, mark: null };
    writeMemory(this.#memory);
    app.toast('Signed out. Your classes are still on this device.', 'ok');
  }

  /** Remove the cloud copy but keep everything local. */
  async forgetCloud(): Promise<boolean> {
    try {
      const response = await fetch('/api/doc', { method: 'DELETE', credentials: 'same-origin' });
      if (!response.ok) throw new Error(String(response.status));
      this.#memory = { rev: 0, mark: null };
      writeMemory(this.#memory);
      this.lastSyncedAt = null;
      app.toast('Cloud copy deleted. This device still has your classes.', 'ok');
      return true;
    } catch {
      app.toast('Could not delete the cloud copy — try again in a moment.', 'warn');
      return false;
    }
  }

  /** Fetch the server's copy and reconcile it with what is on this device. */
  async pull() {
    if (!this.signedIn || this.#inFlight) return;
    this.#inFlight = true;
    this.status = 'syncing';
    try {
      const response = await fetch('/api/doc', { credentials: 'same-origin' });
      if (response.status === 401) return this.#signedOutElsewhere();
      if (response.status === 204) {
        // Nothing stored for this account yet: this device seeds it.
        this.#inFlight = false;
        await this.push();
        return;
      }
      if (!response.ok) throw new Error(String(response.status));

      const body = (await response.json()) as { rev: number; doc: unknown; device: string | null };
      const local = app.snapshot();
      const localMark = fingerprint(local);

      if (this.#memory.rev === body.rev) {
        // Already in step. Push only if this device has moved on since.
        this.status = 'idle';
        if (localMark !== this.#memory.mark) {
          this.#inFlight = false;
          await this.push();
          return;
        }
        this.lastSyncedAt = Date.now();
        return;
      }

      // The server has moved on. Adopt it — but never at the cost of local work.
      const remote = this.#validate(body.doc);
      if (!remote) throw new Error('unreadable document from server');
      const localIsUnsaved = localMark !== this.#memory.mark;
      // The seeded demo class is not the teacher's work; replacing it silently
      // is right, and calling it a conflict would be noise.
      if (localIsUnsaved && !app.isSample) {
        app.captureVersion('safety', `From this device — before ${body.device ?? 'another device'} synced`);
      }
      app.adoptState(remote);
      app.saveNow();
      this.#remember(body.rev, fingerprint(remote));
      this.status = 'idle';
      this.lastSyncedAt = Date.now();
      if (localIsUnsaved && !app.isSample) {
        app.toast(
          `Picked up newer work from ${body.device ?? 'another device'}. This device's copy is in History.`,
          'info'
        );
      }
    } catch (error) {
      this.#failed(error);
    } finally {
      this.#inFlight = false;
    }
  }

  /** Send this device's document up, unless the server has moved on. */
  async push() {
    if (!this.signedIn) return;
    // The sample class belongs to the site, not the teacher; never upload it.
    if (app.isSample) {
      this.status = 'idle';
      return;
    }
    if (this.#inFlight) {
      this.#dirtyAgain = true;
      return;
    }
    const state = app.snapshot();
    const mark = fingerprint(state);
    if (mark === this.#memory.mark) {
      this.status = 'idle';
      return;
    }

    this.#inFlight = true;
    this.status = 'syncing';
    try {
      const response = await fetch('/api/doc', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'If-Match': String(this.#memory.rev) },
        body: JSON.stringify({ doc: state, device: deviceLabel() }),
      });
      if (response.status === 401) return this.#signedOutElsewhere();

      if (response.status === 409) {
        // Another device wrote first. Keep this device's work as a version, take
        // theirs, and let the teacher choose which one they meant.
        const body = (await response.json()) as { rev: number; doc: unknown; device: string | null };
        const remote = this.#validate(body.doc);
        if (!remote) throw new Error('unreadable document from server');
        app.captureVersion('safety', `From this device — before ${body.device ?? 'another device'} synced`);
        app.adoptState(remote);
        app.saveNow();
        this.#remember(body.rev, fingerprint(remote));
        this.status = 'idle';
        this.lastSyncedAt = Date.now();
        app.toast(
          `${body.device ?? 'Another device'} had newer changes. This device's copy is saved in History.`,
          'info'
        );
        return;
      }
      if (!response.ok) throw new Error(String(response.status));

      const body = (await response.json()) as { rev: number };
      this.#remember(body.rev, mark);
      this.status = 'idle';
      this.lastSyncedAt = Date.now();
    } catch (error) {
      this.#failed(error);
    } finally {
      this.#inFlight = false;
      if (this.#dirtyAgain) {
        this.#dirtyAgain = false;
        this.#schedulePush();
      }
    }
  }

  #schedulePush() {
    if (!this.signedIn) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.push();
    }, PUSH_DEBOUNCE_MS);
  }

  /** Send now — the tab is going away and the debounce would never fire. */
  #flush() {
    if (!this.#timer) return;
    clearTimeout(this.#timer);
    this.#timer = null;
    void this.push();
  }

  #remember(rev: number, mark: string) {
    this.#memory = { rev, mark };
    writeMemory(this.#memory);
  }

  /**
   * Everything arriving from the network goes through the same defensive parse
   * that a restored backup file does, so a malformed or hostile document cannot
   * reach the UI. It is the reason the server can treat the blob as opaque.
   */
  #validate(doc: unknown): PersistedState | null {
    try {
      return parseBackup(JSON.stringify(doc));
    } catch {
      return null;
    }
  }

  #signedOutElsewhere() {
    this.email = null;
    this.status = 'off';
    this.#inFlight = false;
    app.toast('Signed out. Your classes are still on this device.', 'info');
  }

  #failed(error: unknown) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    this.status = offline ? 'offline' : 'error';
    // Never a toast: sync failing is not something a teacher has to act on, and
    // their work is safe on the device either way. The status pill says it.
    console.warn('[RosterOwl] sync:', error);
  }
}

export const sync = new Sync();
