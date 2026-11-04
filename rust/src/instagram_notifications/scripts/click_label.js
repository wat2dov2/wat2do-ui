(() => {
  const text = @@TEXT@@;
  const label = element => (element.innerText || element.textContent || "").trim().toLowerCase();
  const matches = [...document.querySelectorAll('button,[role="button"],a')]
    .filter(element => label(element) === text);
  if (matches.length !== 1) return matches.length ? "ambiguous" : "missing";
  matches[0].click();
  return "clicked";
})()