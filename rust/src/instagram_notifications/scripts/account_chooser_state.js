(() => [...document.querySelectorAll('h1,[role="heading"]')]
  .some(element =>
    (element.innerText || element.textContent || "").trim() === "Switch accounts"
  )
  ? "ready" : "pending")()