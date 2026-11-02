(() => {
  const settings = document.querySelector('[aria-label="Settings"]');
  const more = settings?.closest('a,[role="link"]');
  if (!more) return "missing";
  more.click();
  return "clicked";
})()