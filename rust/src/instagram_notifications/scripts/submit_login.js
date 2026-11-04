(() => {
  const [username, password] = [@@USERNAME@@, @@PASSWORD@@];
  const forms = [...document.querySelectorAll('[role="dialog"]'), document];
  const scope = forms.find(form => form.querySelector('input[name="password"]'));
  if (!scope) return "missing";
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  const fill = (input, value) => {
    input.focus();
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", {bubbles: true}));
  };
  const user = scope.querySelector('input[name="username"]');
  if (user) fill(user, username);
  fill(scope.querySelector('input[name="password"]'), password);
  const label = element => (element.innerText || element.textContent || "").trim();
  const button = [...scope.querySelectorAll('button,[role="button"]')]
    .find(element => label(element) === "Log in");
  if (!button) return "missing";
  button.click();
  return "submitted";
})()