// Stylique — Add New Product from Image.
//
// Allows a brand to upload product photos, hit "Generate Details" to let
// Gemini Vision fill title/description/category/tags/price, review + edit
// the pre-filled form, then publish to Shopify with a single click.
//
// Two publish actions:
//   • "Create on Shopify + Generate Creative" — creates product AND enqueues a
//     Studio creative-set job so the brand gets marketing visuals too.
//   • "Create on Shopify Only" — creates the product without Studio.
//
// Matching the dark editorial aesthetic used on app.dashboard.tsx.

import { useState, useRef, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import { authenticate } from "../shopify.server";

// ── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({ ok: true });
}

// ── Action ───────────────────────────────────────────────────────────────────
// The page POSTs here to trigger the actual Shopify product creation.
// We relay to the API route logic directly to keep it in one place.

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const intent = formData.get("_intent") as string | null;
  if (intent !== "create") {
    return json({ ok: false, error: "invalid_intent" }, { status: 400 });
  }

  const title = formData.get("title") as string | null;
  const description = formData.get("description") as string | null;
  const category = formData.get("category") as string | null;
  const tags = formData.get("tags") as string | null;
  const price = formData.get("price") as string | null;
  const currency = formData.get("currency") as string | null;
  const compareAtPrice = formData.get("compareAtPrice") as string | null;
  const createCreativeSet = formData.get("createCreativeSet") === "true";
  const imagesJson = formData.get("images") as string | null;

  if (!title || !price || !imagesJson) {
    return json({ ok: false, error: "missing_required_fields" }, { status: 422 });
  }

  let images: Array<{ data: string; mimeType: string; filename: string }>;
  try {
    images = JSON.parse(imagesJson);
  } catch {
    return json({ ok: false, error: "invalid_images_payload" }, { status: 400 });
  }

  // Call the product-create API route internally.
  const apiUrl = new URL(request.url);
  apiUrl.pathname = "/api/admin/products/create";

  const apiResp = await fetch(apiUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Forward cookie so the API route can authenticate.
      Cookie: request.headers.get("cookie") ?? "",
    },
    body: JSON.stringify({
      images,
      generateDetails: false,
      details: {
        title: title.slice(0, 255),
        description: description ?? "",
        category: category ?? "Other",
        tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        price: parseFloat(price) || 0,
        currency: currency ?? "USD",
        compareAtPrice: compareAtPrice ? parseFloat(compareAtPrice) : undefined,
      },
      createCreativeSet,
    }),
  });

  let result: {
    ok: boolean;
    shopifyHandle?: string;
    shopifyProductId?: string;
    creativeSetId?: string;
    error?: string;
  };
  try {
    result = (await apiResp.json()) as typeof result;
  } catch {
    return json({ ok: false, error: "api_error" }, { status: 502 });
  }

  if (!result.ok) {
    return json({ ok: false, error: result.error ?? "create_failed" }, { status: 422 });
  }

  // Redirect to Shopify product page (opens in admin).
  const shopDomain = session.shop;
  const productId = result.shopifyProductId;
  const redirectUrl = createCreativeSet
    ? `/app/dashboard?product_created=${encodeURIComponent(result.shopifyHandle ?? productId ?? "")}`
    : `/app/dashboard?product_created=${encodeURIComponent(result.shopifyHandle ?? productId ?? "")}`;

  return redirect(redirectUrl);
}

// ── Page component ────────────────────────────────────────────────────────────

type ImagePreview = {
  id: string;
  file: File;
  dataUrl: string;
  base64: string;
  mimeType: string;
};

type GeneratedDetails = {
  title: string;
  description: string;
  category: string;
  tags: string;
  price: string;
  currency: string;
  confidenceScore: number;
};

const CATEGORIES = [
  "Tops",
  "Bottoms",
  "Dresses",
  "Outerwear",
  "Footwear",
  "Accessories",
  "Other",
];

const CURRENCIES = ["USD", "GBP", "PKR"] as const;

export default function AddProductPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const [images, setImages] = useState<ImagePreview[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Form fields — pre-filled by AI, editable before publish.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Other");
  const [tags, setTags] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<"USD" | "GBP" | "PKR">("USD");
  const [compareAtPrice, setCompareAtPrice] = useState("");
  const [confidenceScore, setConfidenceScore] = useState<number | null>(null);
  const [detailsGenerated, setDetailsGenerated] = useState(false);

  const isSubmitting = navigation.state === "submitting";

  // ── Image handling ─────────────────────────────────────────────────────────

  const processFile = useCallback(
    (file: File): Promise<ImagePreview | null> => {
      return new Promise((resolve) => {
        if (!file.type.match(/^image\/(jpeg|png|webp|heic|heif)$/)) {
          resolve(null);
          return;
        }
        if (file.size > 6 * 1024 * 1024) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          if (!dataUrl) { resolve(null); return; }
          // Strip data URI prefix to get raw base64.
          const base64 = dataUrl.split(",")[1] ?? "";
          resolve({
            id: Math.random().toString(36).slice(2),
            file,
            dataUrl,
            base64,
            mimeType: file.type,
          });
        };
        reader.readAsDataURL(file);
      });
    },
    [],
  );

  const addFiles = useCallback(
    async (files: FileList | null) => {
      if (!files) return;
      const remaining = 5 - images.length;
      if (remaining <= 0) return;
      const toProcess = Array.from(files).slice(0, remaining);
      const results = await Promise.all(toProcess.map(processFile));
      const valid = results.filter(Boolean) as ImagePreview[];
      setImages((prev) => [...prev, ...valid].slice(0, 5));
    },
    [images.length, processFile],
  );

  const removeImage = (id: string) =>
    setImages((prev) => prev.filter((img) => img.id !== id));

  // ── Drag-and-drop ──────────────────────────────────────────────────────────

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  };

  // ── AI generation ──────────────────────────────────────────────────────────

  const handleGenerateDetails = async () => {
    if (images.length === 0 || isGenerating) return;
    setIsGenerating(true);
    setGenerateError(null);
    try {
      const resp = await fetch("/api/admin/products/generate-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: {
            data: images[0].base64,
            mimeType: images[0].mimeType,
            filename: images[0].file.name,
          },
        }),
      });

      type GenerateResp = {
        ok: boolean;
        error?: string;
        details?: {
          title: string;
          description: string;
          category: string;
          tags: string[];
          suggestedPriceRange: { min: number; max: number; currency: string };
          primaryColor: string;
          fabricHint: string;
          seasonHint: string;
          confidenceScore: number;
        };
      };

      const data = (await resp.json()) as GenerateResp;

      if (!data.ok || !data.details) {
        setGenerateError("AI generation failed. Please fill in the details manually.");
        return;
      }

      const d = data.details;
      setTitle(d.title);
      setDescription(d.description);
      setCategory(d.category);
      setTags(d.tags.join(", "));
      if (d.suggestedPriceRange.min > 0) {
        setPrice(String(d.suggestedPriceRange.min));
      }
      const cur = d.suggestedPriceRange.currency;
      if (cur === "GBP" || cur === "PKR" || cur === "USD") {
        setCurrency(cur);
      }
      setConfidenceScore(d.confidenceScore);
      setDetailsGenerated(true);
    } catch (err) {
      setGenerateError("Generation failed. Please fill in the details manually.");
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Form submit via useSubmit (to attach images JSON) ─────────────────────

  const handlePublish = (withCreativeSet: boolean) => {
    if (images.length === 0 || !title.trim()) return;
    const fd = new FormData();
    fd.append("_intent", "create");
    fd.append("title", title);
    fd.append("description", description);
    fd.append("category", category);
    fd.append("tags", tags);
    fd.append("price", price);
    fd.append("currency", currency);
    fd.append("compareAtPrice", compareAtPrice);
    fd.append("createCreativeSet", String(withCreativeSet));
    fd.append(
      "images",
      JSON.stringify(
        images.map((img) => ({
          data: img.base64,
          mimeType: img.mimeType,
          filename: img.file.name,
        })),
      ),
    );
    submit(fd, { method: "post" });
  };

  const canPublish = images.length > 0 && title.trim().length > 0 && !isSubmitting;

  return (
    <div className="sq-shell">
      <style dangerouslySetInnerHTML={{ __html: PAGE_STYLES }} />

      {/* ─── Header ───────────────────────────────────────────────────── */}
      <header className="sq-header">
        <div>
          <div className="sq-eyebrow">
            <span className="sq-eyebrow__dot" /> Stylique · Products
          </div>
          <h1 className="sq-h1">
            <span className="serif">Add New</span>
            <em className="serif"> Product</em>
          </h1>
          <p className="sq-sub">
            Upload product images and we&rsquo;ll generate the details for you
          </p>
        </div>
      </header>

      {/* ─── Error banner ─────────────────────────────────────────────── */}
      {actionData && !actionData.ok && (
        <div className="sq-error-banner" role="alert">
          {(actionData as { error?: string }).error === "missing_required_fields"
            ? "Please fill in the title and price before publishing."
            : "Something went wrong. Please try again."}
        </div>
      )}

      <div className="sq-np-layout">
        {/* ─── Left: upload + preview ──────────────────────────────── */}
        <section className="sq-card sq-np-upload-col">
          <div className="sq-card__head">
            <h2>Product Images</h2>
            <span className="sq-tag">Up to 5 · 6MB each</span>
          </div>

          {/* Drop zone */}
          <div
            ref={dropZoneRef}
            className={`sq-dropzone${isDragging ? " sq-dropzone--active" : ""}${images.length >= 5 ? " sq-dropzone--disabled" : ""}`}
            onClick={() =>
              images.length < 5 && fileInputRef.current?.click()
            }
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            aria-label="Upload product images"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sq-dropzone__input"
              onChange={(e) => addFiles(e.target.files)}
            />
            <div className="sq-dropzone__icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <rect
                  x="1"
                  y="1"
                  width="38"
                  height="38"
                  rx="11"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                />
                <path
                  d="M20 12v12m0-12l-4 4m4-4l4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M11 28h18"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            {images.length < 5 ? (
              <>
                <p className="sq-dropzone__label">
                  Drop product images here or click to browse
                </p>
                <p className="sq-dropzone__sub">JPEG · PNG · WebP · up to 6 MB</p>
              </>
            ) : (
              <p className="sq-dropzone__label">Maximum 5 images reached</p>
            )}
          </div>

          {/* Preview grid */}
          {images.length > 0 && (
            <div className="sq-img-grid">
              {images.map((img) => (
                <div key={img.id} className="sq-img-card">
                  <img
                    src={img.dataUrl}
                    alt={img.file.name}
                    className="sq-img-card__thumb"
                  />
                  <button
                    type="button"
                    className="sq-img-card__remove"
                    onClick={() => removeImage(img.id)}
                    aria-label="Remove image"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Generate button */}
          {images.length > 0 && (
            <button
              type="button"
              className="sq-btn-generate"
              disabled={isGenerating}
              onClick={handleGenerateDetails}
            >
              {isGenerating ? (
                <>
                  <span className="sq-spinner" aria-hidden /> Generating…
                </>
              ) : (
                "✦ Generate Details with AI"
              )}
            </button>
          )}

          {generateError && (
            <p className="sq-generate-error">{generateError}</p>
          )}

          {confidenceScore !== null && detailsGenerated && (
            <p className="sq-confidence">
              AI confidence:{" "}
              <strong>{Math.round(confidenceScore * 100)}%</strong>
              {confidenceScore < 0.5
                ? " — review carefully"
                : confidenceScore < 0.8
                  ? " — looks good"
                  : " — high confidence"}
            </p>
          )}
        </section>

        {/* ─── Right: details form ──────────────────────────────────── */}
        <section className="sq-card sq-np-form-col">
          <div className="sq-card__head">
            <h2>Product Details</h2>
            {detailsGenerated && (
              <span className="sq-tag sq-tag--ai">✦ AI-filled · review &amp; edit</span>
            )}
          </div>

          <div className="sq-form-body">
            {/* Title */}
            <label className="sq-label" htmlFor="np-title">
              Product Title <span className="sq-required">*</span>
            </label>
            <input
              id="np-title"
              className="sq-input"
              type="text"
              maxLength={255}
              placeholder="e.g. Ivory Linen Wide-Leg Trousers"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />

            {/* Description */}
            <label className="sq-label" htmlFor="np-desc">
              Description
            </label>
            <textarea
              id="np-desc"
              className="sq-textarea"
              rows={3}
              maxLength={4000}
              placeholder="2-3 sentences in an editorial tone…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            {/* Category */}
            <label className="sq-label" htmlFor="np-category">
              Category
            </label>
            <select
              id="np-category"
              className="sq-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            {/* Tags */}
            <label className="sq-label" htmlFor="np-tags">
              Tags{" "}
              <span className="sq-label-hint">comma-separated</span>
            </label>
            <input
              id="np-tags"
              className="sq-input"
              type="text"
              placeholder="linen, wide-leg, summer, ivory, relaxed-fit"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />

            {/* Price row */}
            <div className="sq-price-row">
              <div className="sq-price-field">
                <label className="sq-label" htmlFor="np-price">
                  Price <span className="sq-required">*</span>
                </label>
                <div className="sq-price-input-wrap">
                  <select
                    className="sq-select sq-select--currency"
                    value={currency}
                    onChange={(e) =>
                      setCurrency(e.target.value as "USD" | "GBP" | "PKR")
                    }
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    id="np-price"
                    className="sq-input sq-input--price"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="sq-price-field">
                <label className="sq-label" htmlFor="np-compare">
                  Compare-at Price{" "}
                  <span className="sq-label-hint">optional</span>
                </label>
                <input
                  id="np-compare"
                  className="sq-input"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={compareAtPrice}
                  onChange={(e) => setCompareAtPrice(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Publish CTAs */}
          <div className="sq-np-actions">
            <button
              type="button"
              className="sq-btn-primary"
              disabled={!canPublish}
              onClick={() => handlePublish(true)}
            >
              {isSubmitting
                ? "Creating…"
                : "Create on Shopify + Generate Creative"}
            </button>
            <button
              type="button"
              className="sq-btn-ghost"
              disabled={!canPublish}
              onClick={() => handlePublish(false)}
            >
              Create on Shopify Only
            </button>
          </div>

          {images.length === 0 && (
            <p className="sq-np-hint">
              Upload at least one product image to get started.
            </p>
          )}
          {images.length > 0 && !title.trim() && (
            <p className="sq-np-hint">
              Add a product title to enable publishing.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const PAGE_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --sq-bg: #08070A;
  --sq-surface: #14111A;
  --sq-surface-2: rgba(255,255,255,0.025);
  --sq-line: rgba(255,255,255,0.08);
  --sq-line-2: rgba(255,255,255,0.14);
  --sq-line-accent: rgba(201,181,255,0.35);
  --sq-text: #F4F2EE;
  --sq-mute: #8E8A99;
  --sq-mute-2: #5A5663;
  --sq-electric: #8B5CF6;
  --sq-pink: #E879C8;
  --sq-grad: linear-gradient(135deg, #8B5CF6 0%, #C26BE6 55%, #E879C8 100%);
  --sq-shadow: 0 24px 60px rgba(0,0,0,.55);
}

.sq-shell {
  font-family: "Manrope", ui-sans-serif, system-ui, sans-serif;
  background: var(--sq-bg);
  color: var(--sq-text);
  min-height: 100vh;
  padding: 32px 36px 64px;
  position: relative;
  overflow-x: hidden;
}
.sq-shell::before {
  content: ""; position: absolute; inset: -10% -10% auto -10%; height: 360px;
  background: radial-gradient(60% 60% at 50% 0%, rgba(139,92,246,.18) 0%, rgba(232,121,200,.04) 50%, rgba(0,0,0,0) 80%);
  pointer-events: none; z-index: 0;
}
.sq-shell > * { position: relative; z-index: 1; }

.serif { font-family: "Instrument Serif", "Cormorant Garamond", Georgia, serif; font-weight: 400; }
.mono  { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11.5px; letter-spacing: .3px; color: var(--sq-mute); }

/* Header */
.sq-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-bottom: 28px; padding-bottom: 24px; border-bottom: 1px solid var(--sq-line); }
.sq-eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 10.5px; letter-spacing: 1.6px; text-transform: uppercase; color: var(--sq-mute); margin-bottom: 8px; }
.sq-eyebrow__dot { width: 6px; height: 6px; border-radius: 999px; background: var(--sq-electric); box-shadow: 0 0 8px var(--sq-electric); }
.sq-h1 { font-size: 48px; line-height: 1; letter-spacing: -0.5px; margin: 0; font-weight: 400; }
.sq-h1 em { font-style: italic; background: var(--sq-grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sq-sub { font-size: 13px; color: var(--sq-mute); margin: 12px 0 0; }

/* Cards */
.sq-card { padding: 24px; border: 1px solid var(--sq-line); border-radius: 18px; background: var(--sq-surface); box-shadow: var(--sq-shadow); }
.sq-card__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; gap: 16px; flex-wrap: wrap; }
.sq-card__head h2 { font-size: 20px; margin: 0; font-weight: 400; }
.sq-tag { font-size: 10.5px; letter-spacing: 1.4px; text-transform: uppercase; color: var(--sq-mute); padding: 4px 10px; border: 1px solid var(--sq-line-2); border-radius: 999px; }
.sq-tag--ai { color: var(--sq-electric); border-color: rgba(139,92,246,.35); }

/* Layout */
.sq-np-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: flex-start; }
@media (max-width: 900px) { .sq-np-layout { grid-template-columns: 1fr; } }
.sq-np-upload-col { display: flex; flex-direction: column; gap: 18px; }
.sq-np-form-col { display: flex; flex-direction: column; gap: 0; }

/* Drop zone */
.sq-dropzone {
  border: 1.5px dashed var(--sq-line-2);
  border-radius: 14px;
  padding: 32px 24px;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  cursor: pointer;
  transition: border-color .2s, background .2s;
  text-align: center;
  background: var(--sq-surface-2);
  color: var(--sq-mute);
}
.sq-dropzone:hover, .sq-dropzone:focus { border-color: var(--sq-line-accent); color: var(--sq-text); outline: none; }
.sq-dropzone--active { border-color: var(--sq-electric); background: rgba(139,92,246,.07); }
.sq-dropzone--disabled { cursor: not-allowed; opacity: .5; }
.sq-dropzone__input { display: none; }
.sq-dropzone__icon { opacity: .45; }
.sq-dropzone__label { font-size: 14px; font-weight: 500; margin: 0; }
.sq-dropzone__sub { font-size: 11.5px; color: var(--sq-mute-2); margin: 0; letter-spacing: .3px; }

/* Preview grid */
.sq-img-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 10px; }
.sq-img-card { position: relative; border-radius: 10px; overflow: hidden; aspect-ratio: 3/4; background: var(--sq-surface-2); border: 1px solid var(--sq-line); }
.sq-img-card__thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
.sq-img-card__remove { position: absolute; top: 5px; right: 5px; width: 22px; height: 22px; border-radius: 999px; background: rgba(0,0,0,.7); border: none; color: #fff; cursor: pointer; font-size: 14px; line-height: 1; display: flex; align-items: center; justify-content: center; padding: 0; }
.sq-img-card__remove:hover { background: rgba(232,121,200,.85); }

/* Generate button */
.sq-btn-generate {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  width: 100%;
  padding: 14px 20px;
  background: linear-gradient(135deg, rgba(139,92,246,.18) 0%, rgba(232,121,200,.12) 100%);
  border: 1px solid rgba(139,92,246,.4);
  border-radius: 12px;
  color: var(--sq-text);
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: .3px;
  cursor: pointer;
  transition: border-color .2s, background .2s;
}
.sq-btn-generate:hover:not(:disabled) { border-color: var(--sq-electric); background: rgba(139,92,246,.24); }
.sq-btn-generate:disabled { opacity: .5; cursor: not-allowed; }

/* Spinner */
.sq-spinner {
  display: inline-block; width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,.15);
  border-top-color: var(--sq-electric);
  border-radius: 50%;
  animation: sq-spin .7s linear infinite;
}
@keyframes sq-spin { to { transform: rotate(360deg); } }

.sq-generate-error { font-size: 12.5px; color: var(--sq-pink); margin: 0; padding: 10px 14px; border: 1px solid rgba(232,121,200,.25); border-radius: 8px; background: rgba(232,121,200,.05); }
.sq-confidence { font-size: 12.5px; color: var(--sq-mute); margin: 0; }
.sq-confidence strong { color: var(--sq-text); }

/* Error banner */
.sq-error-banner { background: rgba(232,121,200,.08); border: 1px solid rgba(232,121,200,.3); border-radius: 10px; padding: 12px 16px; font-size: 13.5px; color: var(--sq-pink); margin-bottom: 18px; }

/* Form */
.sq-form-body { display: flex; flex-direction: column; gap: 14px; }
.sq-label { font-size: 11.5px; letter-spacing: .8px; text-transform: uppercase; color: var(--sq-mute); display: block; margin-bottom: 5px; }
.sq-label-hint { text-transform: none; letter-spacing: 0; font-size: 11px; }
.sq-required { color: var(--sq-pink); }

.sq-input, .sq-textarea, .sq-select {
  width: 100%;
  background: rgba(255,255,255,.04);
  border: 1px solid var(--sq-line-2);
  border-radius: 9px;
  padding: 10px 12px;
  color: var(--sq-text);
  font-family: inherit;
  font-size: 14px;
  transition: border-color .15s;
  box-sizing: border-box;
}
.sq-input:focus, .sq-textarea:focus, .sq-select:focus { outline: none; border-color: var(--sq-line-accent); }
.sq-input::placeholder, .sq-textarea::placeholder { color: var(--sq-mute-2); }
.sq-textarea { resize: vertical; min-height: 80px; }
.sq-select { cursor: pointer; -webkit-appearance: none; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' fill='none'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%238E8A99' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px; }
option { background: #1a1624; color: var(--sq-text); }

/* Price row */
.sq-price-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.sq-price-field { display: flex; flex-direction: column; }
.sq-price-input-wrap { display: flex; gap: 0; }
.sq-select--currency { border-radius: 9px 0 0 9px; border-right: none; width: auto; flex-shrink: 0; min-width: 72px; }
.sq-input--price { border-radius: 0 9px 9px 0; }

/* Actions */
.sq-np-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--sq-line); }
.sq-btn-primary {
  width: 100%;
  padding: 15px 20px;
  background: var(--sq-grad);
  border: none;
  border-radius: 12px;
  color: #fff;
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: .3px;
  cursor: pointer;
  transition: opacity .15s;
}
.sq-btn-primary:hover:not(:disabled) { opacity: .88; }
.sq-btn-primary:disabled { opacity: .4; cursor: not-allowed; }

.sq-btn-ghost {
  width: 100%;
  padding: 13px 20px;
  background: transparent;
  border: 1px solid var(--sq-line-2);
  border-radius: 12px;
  color: var(--sq-mute);
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: color .15s, border-color .15s;
}
.sq-btn-ghost:hover:not(:disabled) { color: var(--sq-text); border-color: var(--sq-line-accent); }
.sq-btn-ghost:disabled { opacity: .4; cursor: not-allowed; }

.sq-np-hint { font-size: 12px; color: var(--sq-mute-2); margin: 8px 0 0; text-align: center; }
`;
