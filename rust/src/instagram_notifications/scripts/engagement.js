(() => {
  const fail = reason => JSON.stringify({status: "failed", reason});
  const result = status => JSON.stringify({status});
  const context = @@POST_CONTEXT@@;
  if (context.status !== "ready") return fail(context.reason);
  if ((@@CURRENT_ACCOUNT_USERNAME@@) !== @@USERNAME@@ ||
      (@@RECIPIENT_IS_ACTIVE@@) !== "true") return fail("wrong_account");
  const {toolbar, visible, labels} = context;
  const action = @@ACTION@@;
  const names = {like: ["Like", "Unlike"], save: ["Save", "Remove", "Unsave"],
    repost: ["Repost", "Undo repost", "Remove repost"]}[action];
  const controls = [...new Set([...toolbar.querySelectorAll("[aria-label]")]
    .filter(node => names.includes(node.getAttribute("aria-label")) && visible(node))
    .map(node => node.closest('button,[role="button"]')).filter(Boolean))];
  if (!controls.length && action === "repost") return result("unsupported");
  if (controls.length !== 1 || !visible(controls[0])) return fail("ambiguous_control");
  const control = controls[0];
  if (control.getAttribute("aria-disabled") === "true" || control.disabled) return result("not_ready");
  const actionLabels = [...new Set(labels(control).filter(name => names.includes(name)))];
  if (actionLabels.length !== 1) return fail("unknown_state");
  const label = actionLabels[0];
  const pressed = control.getAttribute("aria-pressed");
  let done = label !== names[0];
  if (action === "repost" && label === "Repost") {
    if (pressed !== null && pressed !== "true" && pressed !== "false") return fail("unknown_state");
    const paths = [...(control.querySelector('svg[aria-label="Repost"]')?.querySelectorAll('path') || [])];
    const glyph = paths.length === 1 ? paths[0].getAttribute("d") : null;
    const glyphDone = glyph === @@REPOST_ACTIVE_PATH@@ ? true :
      glyph === @@REPOST_INACTIVE_PATH@@ ? false : null;
    if (pressed === "true" || pressed === "false") {
      done = pressed === "true";
      if (glyphDone !== null && glyphDone !== done) return fail("unknown_state");
    } else {
      if (glyphDone === null) return result("unsupported");
      done = glyphDone;
    }
  } else if (pressed !== null && pressed !== String(done)) {
    return fail("unknown_state");
  }
  if (done) return result("already_done");
  if (!@@CLICK@@) return result("ready");
  control.scrollIntoView({behavior: "instant", block: "center"});
  control.click();
  return result("clicked");
})()