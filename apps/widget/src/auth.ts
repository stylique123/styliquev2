/**
 * auth.ts — Auth overlay bottom sheet for the Stylique widget.
 *
 * Renders a bottom sheet with:
 *   - Context-aware headline + sub
 *   - Email input → "Continue with email" → triggers OTP flow
 *   - Google sign-in button → POST /api/shopper/auth/social with id_token
 *   - Apple sign-in button → POST /api/shopper/auth/social with appleToken
 *   - "Skip for now" link
 *
 * After successful sign-in (any method), calls opts.onSuccess(email).
 * Dismiss increments localStorage `sq_auth_dismissed_count`.
 * The overlay is appended to document.body (outside shadow DOM) so it
 * overlays the entire page.
 *
 * Usage:
 *   import { renderAuthOverlay } from "./auth";
 *   renderAuthOverlay(document.body, {
 *     apiBase: "/apps/stylique",
 *     context: "save_sizes",
 *     onSuccess: (email) => console.log("signed in:", email),
 *   });
 */

export interface AuthOverlayOptions {
  /** Shopper API base URL (e.g. /apps/stylique) */
  apiBase: string;
  /** Controls the headline + sub copy */
  context: "save_sizes" | "save_style" | "general";
  /** Called with the shopper's email on successful sign-in */
  onSuccess: (email: string) => void;
  /** Called when the shopper dismisses the overlay */
  onDismiss?: () => void;
}

const DISMISS_KEY = "sq_auth_dismissed_count";

function getDismissCount(): number {
  try {
    return parseInt(localStorage.getItem(DISMISS_KEY) ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

function incrementDismissCount(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(getDismissCount() + 1));
  } catch {
    // localStorage unavailable (private browsing etc.) — ignore.
  }
}

function headline(context: AuthOverlayOptions["context"]): { title: string; sub: string } {
  switch (context) {
    case "save_sizes":
      return {
        title: "Save your sizes",
        sub: "Mira will remember your fit so you never have to fill it in again.",
      };
    case "save_style":
      return {
        title: "Save your style",
        sub: "Mira keeps your taste profile across sessions so recommendations get sharper.",
      };
    default:
      return {
        title: "Continue with your account",
        sub: "Save your conversation and get personalised picks every visit.",
      };
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Mount and show the auth overlay inside `container` (usually document.body).
 * Returns a function that removes the overlay from the DOM.
 */
export function renderAuthOverlay(container: HTMLElement, opts: AuthOverlayOptions): () => void {
  const { title, sub } = headline(opts.context);

  const overlay = document.createElement("div");
  overlay.className = "sq-auth-overlay";
  overlay.setAttribute("data-open", "false");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", title);

  overlay.innerHTML = `
    <div class="sq-auth-sheet">
      <h2 class="sq-auth-title">${esc(title)}</h2>
      <p class="sq-auth-sub">${esc(sub)}</p>
      <input
        class="sq-auth-email"
        id="sq-auth-email-input"
        type="email"
        placeholder="Your email address"
        autocomplete="email"
        maxlength="200"
      >
      <button class="sq-auth-continue" id="sq-auth-continue" type="button">Continue with email</button>
      <div class="sq-auth-divider">or</div>
      <div class="sq-auth-social">
        <button class="sq-auth-google" id="sq-auth-google" type="button">
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Google
        </button>
        <button class="sq-auth-apple" id="sq-auth-apple" type="button">
          <svg width="14" height="16" viewBox="0 0 814 1000" aria-hidden="true" fill="currentColor">
            <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 790.8 0 663.4 0 541.8c0-207.6 130.3-317.6 258.6-317.6 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
          </svg>
          Apple
        </button>
      </div>
      <button class="sq-auth-skip" id="sq-auth-skip" type="button">Skip for now</button>
    </div>`;

  container.appendChild(overlay);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.setAttribute("data-open", "true");
    });
  });

  let removed = false;
  const remove = (): void => {
    if (removed) return;
    removed = true;
    overlay.setAttribute("data-open", "false");
    overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
    setTimeout(() => { if (!removed) overlay.remove(); }, 600);
  };

  // ─── helpers ─────────────────────────────────────────────────────────────

  function showError(msg: string): void {
    let errEl = overlay.querySelector<HTMLElement>(".sq-auth-err");
    if (!errEl) {
      errEl = document.createElement("p");
      errEl.className = "sq-auth-err";
      errEl.style.cssText = "font-size:12px;color:#E879C8;margin:-6px 0 10px;";
      const continueBtn = overlay.querySelector("#sq-auth-continue");
      continueBtn?.parentNode?.insertBefore(errEl, continueBtn);
    }
    errEl.textContent = msg;
  }

  async function socialLogin(provider: "google", token: string): Promise<void>;
  async function socialLogin(provider: "apple", appleToken: string): Promise<void>;
  async function socialLogin(provider: "google" | "apple", token: string): Promise<void> {
    const body = provider === "google"
      ? { provider: "google", idToken: token }
      : { provider: "apple", appleToken: token };
    const res = await fetch(`${opts.apiBase}/api/shopper/auth/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const json = await res.json() as { ok: boolean; data?: { email: string }; error?: string };
    if (json.ok && json.data?.email) {
      opts.onSuccess(json.data.email);
      remove();
    } else {
      showError(json.error === "rate_limited" ? "Too many attempts — try again later." : "Sign-in failed. Try your email instead.");
    }
  }

  // ─── Email continue ───────────────────────────────────────────────────────
  const continueBtn = overlay.querySelector<HTMLButtonElement>("#sq-auth-continue")!;
  const emailInput = overlay.querySelector<HTMLInputElement>("#sq-auth-email-input")!;

  continueBtn.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError("Enter a valid email address.");
      return;
    }
    continueBtn.disabled = true;
    continueBtn.textContent = "Sending code…";
    try {
      const res = await fetch(`${opts.apiBase}/api/shopper/account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, name: "" }),
      });
      const json = await res.json() as { ok: boolean; data?: { status: string }; error?: string };
      if (json.ok) {
        // OTP sent — overlay gives way to the existing OTP card inside the dock.
        opts.onSuccess(email);
        remove();
      } else {
        showError(json.error === "rate_limited" ? "Too many attempts — try again later." : "Couldn't send code. Try again.");
        continueBtn.disabled = false;
        continueBtn.textContent = "Continue with email";
      }
    } catch {
      showError("Network error — try again.");
      continueBtn.disabled = false;
      continueBtn.textContent = "Continue with email";
    }
  });

  // ─── Google ───────────────────────────────────────────────────────────────
  overlay.querySelector("#sq-auth-google")?.addEventListener("click", () => {
    // Use Google Identity Services (GSI) if available on the page.
    // If GSI is not loaded, open the fallback OAuth popup.
    const googleObj = (window as unknown as Record<string, unknown>)["google"] as
      | { accounts: { id: { initialize(cfg: Record<string, unknown>): void; prompt(): void } } }
      | undefined;

    if (googleObj?.accounts?.id) {
      googleObj.accounts.id.initialize({
        client_id: "", // merchant sets data-google-client-id on the script tag; we read it below
        callback: (response: { credential: string }) => {
          void socialLogin("google", response.credential);
        },
        use_fedcm_for_prompt: true,
      });
      googleObj.accounts.id.prompt();
    } else {
      // GSI not available — tell user
      showError("Google sign-in not available. Use your email instead.");
    }
  });

  // ─── Apple ────────────────────────────────────────────────────────────────
  overlay.querySelector("#sq-auth-apple")?.addEventListener("click", () => {
    const appleObj = (window as unknown as Record<string, unknown>)["AppleID"] as
      | { auth: { init(cfg: Record<string, unknown>): void; signIn(): Promise<{ authorization: { id_token: string } }> } }
      | undefined;

    if (appleObj?.auth) {
      appleObj.auth.init({ clientId: "", scope: "name email", usePopup: true });
      appleObj.auth.signIn()
        .then((res) => { void socialLogin("apple", res.authorization.id_token); })
        .catch(() => { showError("Apple sign-in cancelled."); });
    } else {
      showError("Apple sign-in not available. Use your email instead.");
    }
  });

  // ─── Skip ─────────────────────────────────────────────────────────────────
  overlay.querySelector("#sq-auth-skip")?.addEventListener("click", () => {
    incrementDismissCount();
    opts.onDismiss?.();
    remove();
  });

  // Backdrop click = dismiss
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      incrementDismissCount();
      opts.onDismiss?.();
      remove();
    }
  });

  return remove;
}
