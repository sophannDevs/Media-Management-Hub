"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

/**
 * Last resort for an error in the root layout, which (app)/error.tsx can't
 * catch (ARCH-04). It replaces the whole document, so it brings its own
 * <html>, <body> and styles: the app's CSS isn't loaded here. Colours are the
 * app's (cream, olive, near-black ink; WCAG AA).
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#fffdd0", color: "#1c1b17", fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
        <title>Something went wrong · MediaFlow</title>
        <main role="alert" style={{ maxWidth: 480, margin: "12vh auto 0", padding: "0 20px", textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 24px", color: "#6b6852", lineHeight: 1.5 }}>
            MediaFlow couldn&apos;t load this page. Try again — if it keeps happening, check the server log
            {error.digest ? ` for reference ${error.digest}` : ""}.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ background: "#556b2f", color: "#fff", border: 0, borderRadius: 10, padding: "10px 20px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
