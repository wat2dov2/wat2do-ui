(() => {
  // Instagram's one-tap prompt after a login: its button has read "Save info" and,
  // since November 2026, "Save". Clicking it keeps one-tap login for the account.
  const label = element => (element.innerText || element.textContent || "").trim().toLowerCase();
  const labelled = [...document.querySelectorAll('button,[role="button"]')]
    .filter(element => ["save info", "save"].includes(label(element)));
  // Instagram may wrap the button in a role="button" element with the same label; that
  // is one control, clicked on its innermost element so the button's own handler runs.
  let matches = labelled.filter(
    element => !labelled.some(other => other !== element && element.contains(other)));
  // A hidden duplicate of the button is not a second control: with several, only those
  // on screen count.
  // On screen and enabled: Instagram also renders a disabled copy of some controls
  // (aria-disabled="true"), as on its one-tap "Save" prompt since 11-12.
  const shown = element => !!(element.offsetWidth || element.offsetHeight ||
    element.getClientRects?.().length) && element.getAttribute?.("aria-disabled") !== "true" &&
    !element.disabled;
  if (matches.length > 1 && matches.some(shown)) matches = matches.filter(shown);
  if (matches.length !== 1) return matches.length ? "ambiguous" : "missing";
  matches[0].click();
  return "clicked";
})()
