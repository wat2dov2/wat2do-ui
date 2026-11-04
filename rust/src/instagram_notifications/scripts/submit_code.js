(() => {
  const input = document.querySelector(
    'input[name="verificationCode"],input[name="security_code"],input[autocomplete="one-time-code"]');
  if (!input) return "missing";
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  input.focus();
  setValue.call(input, @@CODE@@);
  input.dispatchEvent(new Event("input", {bubbles: true}));
  const label = element => (element.innerText || element.textContent || "").trim().toLowerCase();
  const button = [...document.querySelectorAll('button,[role="button"]')]
    .find(element => ["confirm", "submit", "continue", "next"].includes(label(element)));
  if (!button) return "missing";
  button.click();
  return "submitted";
})()