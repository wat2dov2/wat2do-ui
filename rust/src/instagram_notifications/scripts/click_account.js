(() => {
  const username = @@USERNAME@@;
  const switcherUsername = @@SWITCHER_USERNAME@@;
  const heading = [...document.querySelectorAll('h1,h2,[role="heading"]')]
    .find(element =>
      (element.innerText || element.textContent || "").trim() === "Switch accounts"
    );
  const dialog = heading?.closest('[role="dialog"]');
  const buttons = [...(dialog?.querySelectorAll('button,[role="button"]') || [])];
  const label = element => (element.innerText || element.textContent || "").trim().toLowerCase();
  const school = value => value.match(/^wat2do[.]([a-z0-9_]+)$/)?.[1] ||
    value.match(/^([a-z0-9_]+)[.]wat2do[.](?:io|ca)$/)?.[1];
  const exact = buttons.filter(element => label(element) === switcherUsername);
  // Instagram's saved account chooser can retain its pre-rename label.
  // This only selects an entry: active username and recipient ID are verified after switching.
  const expectedSchool = school(username);
  const matches = exact.length ? exact : buttons.filter(element =>
    expectedSchool && school(label(element)) === expectedSchool);
  if (!matches.length) return "missing";
  // On screen and enabled: Instagram also renders a disabled copy of some controls
  // (aria-disabled="true"), as on its one-tap "Save" prompt since 11-12.
  const shown = element => !!(element.offsetWidth || element.offsetHeight ||
    element.getClientRects?.().length) && element.getAttribute?.("aria-disabled") !== "true" &&
    !element.disabled;
  const onScreen = matches.length > 1 && matches.some(shown) ? matches.filter(shown) : matches;
  if (onScreen.length !== 1) return "ambiguous";
  const button = onScreen[0];
  button.scrollIntoView({behavior: "instant", block: "center"});
  button.click();
  return "clicked";
})()