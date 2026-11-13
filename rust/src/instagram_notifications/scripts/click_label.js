(() => {
  const text = @@TEXT@@;
  const label = element => (element.innerText || element.textContent || "").trim().toLowerCase();
  const shown = element => !!(element.offsetWidth || element.offsetHeight ||
    element.getClientRects?.().length);
  let matches = [...document.querySelectorAll('button,[role="button"],a')]
    .filter(element => label(element) === text);
  // Instagram renders some controls twice and hides one (its logged-out page lists each
  // saved profile so, since 11-12): with several matches, only those on screen count.
  if (matches.length > 1 && matches.some(shown)) matches = matches.filter(shown);
  if (matches.length !== 1) return matches.length ? "ambiguous" : "missing";
  matches[0].click();
  return "clicked";
})()