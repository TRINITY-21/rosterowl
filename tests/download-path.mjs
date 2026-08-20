// A bounded replacement for Playwright's download.path().
//
// download.path() waits for the transfer to finish and has no timeout of its
// own — none, not a long one. Every PDF here is rendered in the page before
// the bytes ever reach disk, so a browser that stalls mid-render (a loaded
// machine, an orphaned Chromium eating the cores, a font fetch that never
// settles) leaves this awaiting forever. That is how a five-second test
// became a thirty-nine-minute CI hang: no output, no failing assertion,
// nothing naming the test that stopped, just a job that had to be killed.
//
// The wait is bounded here instead of at each call site so no future
// download quietly reintroduces it.

/** Milliseconds to allow for the browser to finish writing the file. */
const DEFAULT_TIMEOUT = 30000;

/**
 * Resolves to the downloaded file's path, or rejects once the timeout passes.
 *
 * @param {import('playwright').Download} download
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
export async function downloadPath(download, timeoutMs = DEFAULT_TIMEOUT) {
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `"${download.suggestedFilename()}" was still downloading after ${timeoutMs}ms. ` +
            'The file is written only once the page has finished rendering the PDF, so ' +
            'this usually means the render stalled rather than the disk write.',
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([download.path(), expiry]);
  } finally {
    clearTimeout(timer);
  }
}
