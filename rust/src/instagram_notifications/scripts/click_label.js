(() => {
  const text = @@TEXT@@;
  const label = element => (element.innerText || element.textContent || "").trim().toLowerCase();
  // On screen and enabled: Instagram also renders a disabled copy of some controls
  // (aria-disabled="true"), as on its one-tap "Save" prompt since 11-12.
  const shown = element => !!(element.offsetWidth || element.offsetHeight ||
    element.getClientRects?.().length) && element.getAttribute?.("aria-disabled") !== "true" &&
    !element.disabled;
  let matches = [...document.querySelectorAll('button,[role="button"],a')]
    .filter(element => label(element) === text);
  // Instagram renders some controls twice and hides one (its logged-out page lists each
  // saved profile so, since 11-12): with several matches, only those on screen count.
  if (matches.length > 1 && matches.some(shown)) matches = matches.filter(shown);
  if (matches.length !== 1) return matches.length ? "ambiguous" : "missing";
  matches[0].click();
  return "clicked";
})()