(() => {
  const label = element => (element.innerText || element.textContent || "").trim();
  const headings = [...document.querySelectorAll('h1,h2,[role="heading"]')]
    .filter(element => label(element) === "Switch accounts");
  // With no other account saved, Switch accounts opens a bare login form instead.
  const dialogs = headings.length
    ? headings.map(heading => heading.closest('[role="dialog"]'))
    : [...document.querySelectorAll('[role="dialog"]')]
      .filter(dialog => dialog.querySelector('input[name="password"]'));
  if (dialogs.length !== 1 || !dialogs[0]) return "missing";
  const dialog = dialogs[0];
  // The close icon's label, or the text its <title> gives the button around it.
  const closes = [...new Set([
    ...[...dialog.querySelectorAll('[aria-label="Close"]')]
      .map(icon => icon.closest('button,[role="button"]')),
    ...[...dialog.querySelectorAll('button,[role="button"]')]
      .filter(button => label(button) === "Close"),
  ])];
  if (closes.length !== 1 || !closes[0]) return "missing";
  closes[0].click();
  return "clicked";
})()