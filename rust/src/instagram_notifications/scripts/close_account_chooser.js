(() => {
  const headings = [...document.querySelectorAll('h1,h2,[role="heading"]')].filter(element =>
    (element.innerText || element.textContent || "").trim() === "Switch accounts");
  if (headings.length !== 1) return "missing";
  const dialog = headings[0].closest('[role="dialog"]');
  const closeIcons = [...(dialog?.querySelectorAll('[aria-label="Close"]') || [])];
  if (closeIcons.length !== 1) return "missing";
  const closeIcon = closeIcons[0];
  const close = closeIcon?.closest('button,[role="button"]');
  if (!close) return "missing";
  close.click();
  return "clicked";
})()