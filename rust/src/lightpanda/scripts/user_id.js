(() => {
 const entry = document.cookie.split(";").map(value => value.trim())
  .find(value => value.startsWith("ds_user_id="));
 return entry ? entry.slice("ds_user_id=".length) : "";
})()
