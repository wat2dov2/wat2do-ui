(() => {
  const entry = document.cookie.split(";").map(value => value.trim())
    .find(value => value.startsWith("ds_user_id="));
  const activeRecipient = entry?.slice("ds_user_id=".length) || "";
  return activeRecipient === @@RECIPIENT_ID@@ ? "true" : "false";
})()