JSON.stringify({
 path: window.location.pathname,
 rate_limited: document.readyState === "complete" &&
  document.title === "www.instagram.com" &&
  document.querySelector("#main-frame-error .error-code")?.textContent.trim() === "HTTP ERROR 429"
})