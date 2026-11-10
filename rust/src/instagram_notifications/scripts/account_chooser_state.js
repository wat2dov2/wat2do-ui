(() => {
  const label = element => (element.innerText || element.textContent || "").trim();
  if ([...document.querySelectorAll('h1,h2,[role="heading"]')]
    .some(element => label(element) === "Switch accounts")) return "ready";
  // With no other account saved, Switch accounts opens a bare login form instead.
  return [...document.querySelectorAll('[role="dialog"]')]
    .some(dialog => dialog.querySelector('input[name="password"]')) ? "login" : "pending";
})()