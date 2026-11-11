JSON.stringify((() => {
 const body = document.body;
 const text = body ? (body.innerText || body.textContent || "") : "";
 return {
  path: window.location.pathname,
  login_form: !!(document.querySelector('input[name="email"]') &&
   document.querySelector('input[name="pass"]')),
  code_field: !!document.querySelector(
   'input[name="verificationCode"],input[name="security_code"],input[autocomplete="one-time-code"]'),
  text: text.replace(/\s+/g, " ").trim().slice(0, 4000)
 };
})())
