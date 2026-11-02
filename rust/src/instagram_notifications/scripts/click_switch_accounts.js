(() => {
  const button = [...document.querySelectorAll('button,[role="button"]')]
    .find(element =>
      (element.innerText || element.textContent || "").trim() === "Switch accounts"
    );
  if (!button) return "missing";
  button.click();
  return "clicked";
})()