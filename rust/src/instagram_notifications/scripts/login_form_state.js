JSON.stringify((() => {
 const path = window.location.pathname;
 const text = document.body ? document.body.innerText : "";
 const code = document.querySelector(
  'input[name="verificationCode"],input[name="security_code"],input[autocomplete="one-time-code"]');
 if (code) return {state: "code"};
 if (/^\/(challenge|checkpoint|accounts\/suspended)/.test(path)) return {state: "challenge"};
 if (/password (was|is) incorrect|incorrect password/i.test(text)) return {state: "wrong_password"};
 if (path.startsWith("/accounts/onetap")) return {state: "save_info"};
 if (document.querySelector('input[name="password"]')) return {state: "form"};
 return {state: "pending"};
})())