(() => [...document.querySelectorAll('button,[role="button"]')]
  .some(element => (element.innerText || element.textContent || "").trim() === "Switch accounts")
  ? "ready" : "pending")()