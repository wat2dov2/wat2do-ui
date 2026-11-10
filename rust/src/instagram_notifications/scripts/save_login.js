(() => {
  // Instagram's one-tap prompt after a login: its button has read "Save info" and,
  // since November 2026, "Save". Clicking it keeps one-tap login for the account.
  const label = element => (element.innerText || element.textContent || "").trim().toLowerCase();
  const matches = [...document.querySelectorAll('button,[role="button"]')]
    .filter(element => ["save info", "save"].includes(label(element)));
  if (matches.length !== 1) return matches.length ? "ambiguous" : "missing";
  matches[0].click();
  return "clicked";
})()
