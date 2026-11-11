(() => {
 const key = @@REQUEST_KEY@@;
 const request = {controller: new AbortController(), settled: false, result: {state: "pending"}};
 window[key] = request;
 (async () => {
  let reason = "request_failed";
  let httpStatus = null;
  const failed = (why, status) => {
   reason = why;
   if (Number.isInteger(status) && status >= 100 && status <= 599) httpStatus = status;
   return new Error();
  };
  // The page's own GET, as Instagram's web app sends it. Null only when Instagram says
  // plainly that it will not show the account (gone, or private to this viewer); any
  // other refusal is a block on these reads.
  const read = async path => {
   reason = "request_failed";
   const response = await fetch(path, {credentials: "include",
     signal: request.controller.signal,
     headers: {"x-ig-app-id": @@WEB_APP_ID@@, "x-requested-with": "XMLHttpRequest"}});
   let body = null;
   try { body = await response.json(); } catch (_error) { body = null; }
   let landed = "";
   try { landed = new URL(response.url).pathname; } catch (_error) { landed = ""; }
   const message = typeof body?.message === "string" ? body.message.toLowerCase() : "";
   if (response.status === 401 || landed.startsWith("/accounts/login") ||
       landed.startsWith("/challenge") || body?.require_login === true ||
       ["login_required", "checkpoint_required", "challenge_required"].includes(message) ||
       typeof body?.checkpoint_url === "string") {
    throw failed("login_required", response.status);
   }
   if (response.status === 429) throw failed("http_error", 429);
   if (body?.spam === true || body?.feedback_required === true || message === "feedback_required" ||
       message.includes("try again later") || message.includes("wait a few minutes")) {
    throw failed("blocked", response.status);
   }
   if (response.status === 404 || /not authorized to view user|user not found/.test(message)) return null;
   if (response.status >= 400 && response.status < 500) throw failed("blocked", response.status);
   if (!response.ok) throw failed("http_error", response.status);
   if (body === null || typeof body !== "object") throw failed("invalid_json");
   if (body.status === "fail") throw failed("blocked", response.status);
   return body;
  };
  try {
   if (!(@@ACCOUNT_IS_ACTIVE@@)) throw failed("account_changed");
   let userId = @@USER_ID@@;
   if (userId === null) {
    const profile = await read(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(@@USERNAME@@)}`);
    if (profile === null || !profile.data?.user) {
     request.result = {state: "succeeded", hidden: true};
     return;
    }
    userId = String(profile.data.user.id ?? "");
    if (!/^[1-9][0-9]{0,31}$/.test(userId)) throw failed("invalid_response");
   }
   const query = new URLSearchParams({count: String(@@PAGE_SIZE@@)});
   const maxId = @@MAX_ID@@;
   if (maxId !== null) query.set("max_id", maxId);
   const body = await read(`/api/v1/friendships/${userId}/following/?${query}`);
   if (!(@@ACCOUNT_IS_ACTIVE@@)) throw failed("account_changed");
   if (body === null) {
    request.result = {state: "succeeded", hidden: true};
    return;
   }
   if (!Array.isArray(body.users)) throw failed("invalid_response");
   const text = value => typeof value === "string" ? value : "";
   const users = body.users.map(user => ({
    username: text(user?.username).toLowerCase(),
    full_name: text(user?.full_name),
    pk: String(user?.pk ?? user?.pk_id ?? user?.id ?? ""),
    is_private: user?.is_private === true
   }));
   const next = body.next_max_id;
   request.result = {state: "succeeded", user_id: userId, users,
    next_max_id: typeof next === "string" && next ? next :
     (Number.isInteger(next) ? String(next) : null)};
  } catch (_error) {request.result = {state: "failed", reason, ...(httpStatus === null ? {} : {http_status: httpStatus})};}
  finally {request.settled = true;}
 })();
 return "started";
})()
