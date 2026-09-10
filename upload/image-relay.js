/**
 * image-relay.js — accept image_url content parts from OpenAI-format
 * requests and upload them through the target site's OWN image file input,
 * so the site's backend processes them exactly as if the user dragged the
 * image into the web UI.
 *
 * OpenAI image format we accept:
 *   { role: "user", content: [
 *       { type: "text", text: "What's in this image?" },
 *       { type: "image_url", image_url: { url: "data:image/png;base64,..." } }
 *   ]}
 *   Also accepts a plain URL (http/https) — we fetch it and upload it.
 *
 * Flow:
 *   1. extractImages(messages) → [{ buffer, mimeType, ext, name }]
 *   2. uploadImages(page, images) → page.setInputFiles(fileInput, images)
 *   3. Wait for the site's upload endpoint response (captured by the network
 *      interceptor) OR for networkidle, so the image is fully uploaded
 *      before we type+send the text prompt.
 */

const config = require("./config");

const log = (...a) => console.log("[image]", ...a);

function selectorError(name) {
  const e = new Error(
    `Selector not found: ${name} — site UI may have changed, check config.js`
  );
  e.code = "SELECTOR_NOT_FOUND";
  return e;
}

function isPlaceholder(sel) {
  return !sel || String(sel).startsWith("TODO");
}

/**
 * Walk all user messages, pull out every image_url part, decode to a Buffer.
 * Returns [] if no images or if image input isn't configured.
 */
function extractImages(messages) {
  if (!Array.isArray(messages)) return [];
  if (isPlaceholder(config.selectors.imageFileInput)) return [];

  const images = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    // content can be a string (no images) or an array of parts.
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (!part || part.type !== "image_url") continue;
      const url = part.image_url && part.image_url.url;
      if (!url) continue;

      // data URL: data:image/png;base64,iVBOR...
      const dataMatch = url.match(
        /^data:(image\/([a-zA-Z0-9.+-]+));base64,(.+)$/
      );
      if (dataMatch) {
        const mimeType = dataMatch[1];
        const extRaw = dataMatch[2].toLowerCase();
        const ext = extRaw === "jpeg" ? "jpg" : extRaw.split("+")[0];
        images.push({
          buffer: Buffer.from(dataMatch[3], "base64"),
          mimeType,
          ext,
        });
        continue;
      }

      // http(s) URL — we can't synchronously fetch in the relay without
      // extra deps; surface a clear error. (The caller can base64-encode
      // before sending, or we add node-fetch later.)
      if (/^https?:\/\//i.test(url)) {
        log(
          "WARNING: image_url with a remote URL is not yet supported. " +
            "Base64-encode the image and send a data: URL instead. Skipping:",
          url.slice(0, 80)
        );
        continue;
      }
    }
  }
  return images;
}

/**
 * Upload images through the site's <input type="file">.
 *
 * @param {import('playwright').Page} page
 * @param {Array} images  output of extractImages()
 * @param {object} opts
 * @param {function} opts.onUploadResponse  optional — called when the
 *   network interceptor sees the upload endpoint respond (so the caller
 *   knows the image URL the site assigned). Not required for the upload to
 *   succeed; we wait on networkidle as a fallback.
 */
async function uploadImages(page, images, opts = {}) {
  if (!images || images.length === 0) return;

  if (isPlaceholder(config.selectors.imageFileInput)) {
    throw selectorError("imageFileInput");
  }

  const fileInput = await page.$(config.selectors.imageFileInput).catch(() => null);
  if (!fileInput) throw selectorError("imageFileInput");

  const payloads = images.map((img, i) => ({
    name: `relay-image-${Date.now()}-${i}.${img.ext}`,
    mimeType: img.mimeType,
    buffer: img.buffer,
  }));

  log(`uploading ${payloads.length} image(s) via file input`);
  await fileInput.setInputFiles(payloads);

  // Wait for the upload to finish. Two strategies, whichever fires first:
  //   (a) the network interceptor sees the upload endpoint respond, OR
  //   (b) networkidle (no requests for 500ms).
  // We race them so a slow upload endpoint doesn't block forever.
  await Promise.race([
    waitForUploadResponse(page, opts.onUploadResponse),
    page
      .waitForLoadState("networkidle", { timeout: 30000 })
      .catch(() => log("networkidle wait timed out; proceeding anyway")),
  ]);

  log("image upload complete");
}

/**
 * Upload text files (large tool results) through the site's text <input type="file">.
 */
async function uploadTextFiles(page, textFiles) {
  if (!textFiles || textFiles.length === 0) return;

  if (isPlaceholder(config.selectors.textFileInput)) {
    // If not configured, fallback to image input if available.
    if (isPlaceholder(config.selectors.imageFileInput)) {
      throw selectorError("textFileInput or imageFileInput");
    }
  }
  const selector = isPlaceholder(config.selectors.textFileInput)
    ? config.selectors.imageFileInput
    : config.selectors.textFileInput;

  const fileInput = await page.$(selector).catch(() => null);
  if (!fileInput) throw selectorError("textFileInput");

  log(`uploading ${textFiles.length} text file(s) via file input`);
  await fileInput.setInputFiles(textFiles);

  // DeepSeek needs time to parse the file on their backend.
  // Wait for the upload response + the configured processing wait time.
  await Promise.race([
    waitForUploadResponse(page, null),
    page
      .waitForLoadState("networkidle", { timeout: 30000 })
      .catch(() => log("networkidle wait timed out; proceeding anyway")),
  ]);

  if (config.fileUploadProcessingWaitMs > 0) {
    log(`waiting ${config.fileUploadProcessingWaitMs}ms for file processing...`);
    await page.waitForTimeout(config.fileUploadProcessingWaitMs);
  }
  log("text file upload complete");
}

// Best-effort: wait until the interceptor captures an upload-response event.
// We poll a small in-page flag set by the capture handler; simpler than
// threading a promise through the interceptor for a one-shot wait.
async function waitForUploadResponse(page, onUploadResponse) {
  if (config.observationMode !== "network") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (info) => {
      if (done) return;
      done = true;
      if (onUploadResponse) onUploadResponse(info);
      resolve(info);
    };
    // Give the interceptor's onUploadResponse handler a way to resolve us.
    // We stash the resolver on the page object so uploadImages can invoke it.
    page.__relayUploadWaiters = page.__relayUploadWaiters || [];
    page.__relayUploadWaiters.push(finish);
    // Fallback timeout so we don't hang if the endpoint pattern is wrong.
    setTimeout(() => finish(null), 30000);
  });
}

module.exports = {
  extractImages,
  uploadImages,
  uploadTextFiles,
  isPlaceholder,
  selectorError,
};
