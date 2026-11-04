(() => {
 const typed = input => ["", "text", "number", "tel"]
  .includes((input.getAttribute("type") || "").toLowerCase());
 const input = document.querySelector(
  'input[name="verificationCode"],input[name="security_code"],input[autocomplete="one-time-code"]') ||
  [...document.querySelectorAll("input")].find(input => typed(input) && input.name !== "email");
 if (!input) return "missing";
 input.focus();
 if (input.select) input.select();
 return "focused";
})()
