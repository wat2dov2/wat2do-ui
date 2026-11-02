JSON.stringify((() => {
 const path = window.location.pathname;
 if (/^\/(challenge|checkpoint|accounts\/suspended)/.test(path)) return {state: "challenge"};
 if (document.querySelector('a[href*="/direct/inbox"]')) {
  return {state: path.startsWith("/accounts/onetap") ? "save_info" : "logged_in"};
 }
 if (document.querySelector('input[type="password"]')) return {state: "password"};
 const label = element => (element.innerText || element.textContent || "").trim().toLowerCase();
 const profiles = [...document.querySelectorAll('button,[role="button"],a')]
  .map(label).filter(text => /^[a-z0-9._]{1,30}$/.test(text));
 return {state: profiles.length ? "profiles" : "loading", profiles};
})())